import "server-only";
import {
  Prisma,
  type Circuit,
  type Currency,
  type DocumentType,
  type ExpenseCategory,
  type PaymentMethod,
  type SupplierCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatQuantity, sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { getRetirosDelPeriodo, getVencimientos, litrosDeLinea } from "@/lib/ledger";
import { getCostoInsumos, getCostosUnitarios, getRentabilidad } from "@/lib/dashboard-kpis";
import { getCotizador, type Cotizador } from "@/lib/cotizaciones";
import { costoDelGasto, GASTOS_WHERE, rubroDelGasto } from "@/lib/caja";
import { getAllItemStocks } from "@/lib/stock";
import { formatProductBrandLabel, formatProductLabel } from "@/lib/product-label";
import { addDays, hoyComoFecha, monthPeriod, periodLastDay, type Period } from "@/lib/period";
import { NUMERO_SALDO_INICIAL } from "@/lib/saldo-inicial";

export const REPORT_KEYS = [
  "remitos-vencidos",
  "insumos-bajo-minimo",
  "valorizacion-insumos",
  "ventas",
  "cobranzas",
  "compras",
  "gastos",
  "cierre-mes",
  "costo-botella",
  "produccion",
  "stock",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_LABELS: Record<ReportKey, string> = {
  "remitos-vencidos": "Comprobantes vencidos",
  "insumos-bajo-minimo": "Insumos bajo mínimo",
  "valorizacion-insumos": "Valorización de insumos",
  ventas: "Ventas / entregas",
  cobranzas: "Cobranzas y pagos",
  compras: "Compras de insumos",
  gastos: "Gastos",
  "cierre-mes": "Cierre del mes",
  "costo-botella": "Costo por botella",
  produccion: "Producción",
  stock: "Stock y recuentos",
};

/** Reportes que son una foto del momento y no de un período: el nombre del archivo lleva "al <fecha>". */
export const REPORT_KEYS_SNAPSHOT: ReportKey[] = ["remitos-vencidos", "insumos-bajo-minimo", "valorizacion-insumos"];

export function isReportKey(value: string | undefined): value is ReportKey {
  return REPORT_KEYS.includes(value as ReportKey);
}

/** Suma `amount` en el mapa por moneda (los importes nunca se mezclan entre monedas). */
function addByCurrency(map: Map<Currency, Prisma.Decimal>, currency: Currency, amount: Prisma.Decimal) {
  map.set(currency, (map.get(currency) ?? ZERO).plus(amount));
}

/**
 * Suma un monto en pesos: lo que está en dólares entra a "ARS" ya convertido con la cotización del
 * día, y además queda en "USD" tal cual, para poder decir cuánto de ese total eran dólares. Así cada
 * fila de un reporte da el total en pesos sin dejar afuera las cuentas en dólares (Cristian quedaba
 * en $ 0 aunque se le compraba todo el aceite).
 */
function addEnPesos(
  map: Map<Currency, Prisma.Decimal>,
  cot: Cotizador,
  currency: Currency,
  amount: Prisma.Decimal,
  fecha: Date,
  propia?: Prisma.Decimal | null
) {
  addByCurrency(map, "ARS", cot.aPesos(amount, currency, fecha, propia));
  if (currency === "USD") addByCurrency(map, "USD", amount);
}

// ---------------------------------------------------------------------------
// 1. Comprobantes vencidos impagos (remitos y facturas de clientes) — "a hoy", no lleva período
// ---------------------------------------------------------------------------

/** "Saldo inicial" va aparte: es deuda de antes de la app, vencida desde quién sabe cuándo, y
 * contarla en días desde la fecha en que se cargó la haría parecer de la semana pasada. */
export const VENCIDO_BUCKETS = ["1-15", "16-30", "31-60", "60+", "Saldo inicial"] as const;
export type VencidoBucket = (typeof VENCIDO_BUCKETS)[number];

function bucketDe(dias: number): VencidoBucket {
  if (dias <= 15) return "1-15";
  if (dias <= 30) return "16-30";
  if (dias <= 60) return "31-60";
  return "60+";
}

export type VencidoRow = {
  documentId: string;
  type: DocumentType;
  entityName: string;
  entitySlug: string;
  circuit: Circuit;
  number: string;
  date: Date;
  dueDate: Date;
  diasAtraso: number;
  bucket: VencidoBucket;
  /** Deuda de antes de la app: se muestra como tal, sin días de atraso. */
  saldoInicial: boolean;
  currency: Currency;
  total: Prisma.Decimal;
  pendiente: Prisma.Decimal;
};

export type VencidosReport = {
  asOf: Date;
  rows: VencidoRow[];
  totalPendiente: Map<Currency, Prisma.Decimal>;
  porCliente: { entityName: string; entitySlug: string; count: number; pendiente: Prisma.Decimal }[];
  porBucket: { bucket: VencidoBucket; count: number; pendiente: Prisma.Decimal }[];
  clientesAfectados: number;
  atrasoMaximo: number;
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Comprobantes vencidos con saldo pendiente. Incluye remitos y facturas a propósito: cuando un
 * remito se factura, `getDocumentEffect` lo deja en cero y la deuda pasa a vivir en la factura, así
 * que mirar solo remitos escondería casi toda la deuda de los clientes que facturan.
 */
export async function getVencidosReport(options?: {
  asOf?: Date;
  circuit?: Circuit;
}): Promise<VencidosReport> {
  const asOf = options?.asOf ?? new Date();
  const vencimientos = await getVencimientos();

  const rows: VencidoRow[] = [];
  for (const doc of vencimientos) {
    // El saldo inicial es deuda vieja: está vencido desde que se cargó, sin esperar a nadie.
    const saldoInicial = doc.type === "AJUSTE" && doc.number.startsWith(NUMERO_SALDO_INICIAL);
    // El resto, vencido recién cuando el día del vencimiento pasó entero: el que vence hoy todavía no.
    if (!doc.dueDate || (!saldoInicial && doc.dueDate >= hoyComoFecha(asOf))) continue;
    // Lo que nos deben: los comprobantes de proveedores vencidos son otra cosa (lo que debemos).
    if (doc.account.entity.type !== "CLIENTE" && doc.account.entity.type !== "AMBOS") continue;
    if (options?.circuit && doc.account.circuit !== options.circuit) continue;

    const diasAtraso = Math.round((hoyComoFecha(asOf).getTime() - doc.dueDate.getTime()) / MS_POR_DIA);
    rows.push({
      documentId: doc.id,
      type: doc.type,
      entityName: doc.account.entity.name,
      entitySlug: doc.account.entity.slug,
      circuit: doc.account.circuit,
      number: doc.number,
      date: doc.date,
      dueDate: doc.dueDate,
      diasAtraso,
      bucket: saldoInicial ? "Saldo inicial" : bucketDe(diasAtraso),
      saldoInicial,
      currency: doc.currency,
      total: doc.totalAmount,
      pendiente: doc.pending,
    });
  }

  // Lo más viejo arriba: el saldo inicial primero, después por vencimiento.
  rows.sort((a, b) => Number(b.saldoInicial) - Number(a.saldoInicial) || a.dueDate.getTime() - b.dueDate.getTime());

  // Lo vencido es deuda de hoy: lo que está en dólares se valúa con la cotización de hoy. Antes los
  // tramos y el total por cliente sumaban dólares como si fueran pesos, y el total los dejaba afuera.
  const cot = await getCotizador();
  const cotizacionHoy = cot.del(asOf);
  const enPesos = (row: VencidoRow) => cot.aPesos(row.pendiente, row.currency, asOf, cotizacionHoy);
  const totalPendiente = new Map<Currency, Prisma.Decimal>();
  const porClienteMap = new Map<string, { entityName: string; entitySlug: string; count: number; pendiente: Prisma.Decimal }>();
  const porBucketMap = new Map<VencidoBucket, { bucket: VencidoBucket; count: number; pendiente: Prisma.Decimal }>();

  for (const row of rows) {
    addByCurrency(totalPendiente, "ARS", enPesos(row));
    if (row.currency === "USD") addByCurrency(totalPendiente, "USD", row.pendiente);

    const cliente = porClienteMap.get(row.entitySlug) ?? {
      entityName: row.entityName,
      entitySlug: row.entitySlug,
      count: 0,
      pendiente: ZERO,
    };
    cliente.count++;
    cliente.pendiente = cliente.pendiente.plus(enPesos(row));
    porClienteMap.set(row.entitySlug, cliente);

    const bucket = porBucketMap.get(row.bucket) ?? { bucket: row.bucket, count: 0, pendiente: ZERO };
    bucket.count++;
    bucket.pendiente = bucket.pendiente.plus(enPesos(row));
    porBucketMap.set(row.bucket, bucket);
  }

  return {
    asOf,
    rows,
    totalPendiente,
    porCliente: Array.from(porClienteMap.values()).sort((a, b) => b.pendiente.comparedTo(a.pendiente)),
    porBucket: VENCIDO_BUCKETS.map(
      (bucket) => porBucketMap.get(bucket) ?? { bucket, count: 0, pendiente: ZERO }
    ),
    clientesAfectados: porClienteMap.size,
    atrasoMaximo: rows.length > 0 ? Math.max(...rows.map((r) => r.diasAtraso)) : 0,
  };
}

// ---------------------------------------------------------------------------
// 2. Insumos bajo el mínimo — foto de hoy, no lleva período
// ---------------------------------------------------------------------------

export type InsumoBajoMinimo = {
  itemId: string;
  itemSlug: string;
  itemName: string;
  unit: string;
  category: SupplierCategory;
  stock: Prisma.Decimal;
  minStock: Prisma.Decimal;
  /** Cuánto falta para llegar al mínimo. */
  faltante: Prisma.Decimal;
  /** stock / minStock — para ordenar por urgencia. */
  cobertura: Prisma.Decimal;
  unitCost: Prisma.Decimal | null;
  costoReposicion: Prisma.Decimal | null;
};

export type InsumosMinimoReport = {
  asOf: Date;
  /** Ordenados por cobertura ascendente: primero los más desabastecidos. */
  rows: InsumoBajoMinimo[];
  porCategoria: { category: SupplierCategory; count: number; costoReposicion: Prisma.Decimal }[];
  /** Cuántos insumos no tienen mínimo cargado — sin esto, "0 bajo mínimo" engaña. */
  itemsSinMinimo: number;
  totalItems: number;
  costoReposicionTotal: Prisma.Decimal;
};

/**
 * Insumos cuyo stock actual está en o por debajo de su mínimo.
 *
 * Se recorren los insumos y no el mapa de stocks a propósito: getAllItemStocks solo tiene claves
 * para los que registraron algún movimiento, así que un insumo con mínimo cargado y sin movimientos
 * —el caso más urgente de todos— desaparecería del reporte.
 */
export async function getInsumosMinimoReport(options?: { asOf?: Date }): Promise<InsumosMinimoReport> {
  const asOf = options?.asOf ?? new Date();
  const [items, stocks, costoDe] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    getAllItemStocks(),
    getCotizador().then(getCostosUnitarios),
  ]);

  const rows: InsumoBajoMinimo[] = [];
  let itemsSinMinimo = 0;

  for (const item of items) {
    const minStock = item.minStock ? toDecimal(item.minStock) : null;
    // Un mínimo en cero no es un mínimo: no habría forma de estar por debajo.
    if (!minStock || minStock.lessThanOrEqualTo(0)) {
      itemsSinMinimo++;
      continue;
    }

    const stock = stocks.get(item.id) ?? ZERO;
    // Estar justo en el mínimo también avisa: si no, uno se entera recién cuando ya faltó.
    if (!stock.lessThanOrEqualTo(minStock)) continue;

    const faltante = minStock.minus(stock);
    // Lo que cuesta hoy, como en el margen y la valorización: la última compra, o la ficha si nunca
    // se compró. Antes era sólo la ficha, que queda vieja apenas se vuelve a comprar.
    const unitCost = costoDe(item.id, asOf);
    rows.push({
      itemId: item.id,
      itemSlug: item.slug,
      itemName: item.name,
      unit: item.unit,
      category: item.category,
      stock,
      minStock,
      faltante,
      cobertura: stock.dividedBy(minStock),
      unitCost,
      costoReposicion: unitCost ? faltante.times(unitCost) : null,
    });
  }

  rows.sort((a, b) => a.cobertura.comparedTo(b.cobertura));

  const porCategoriaMap = new Map<SupplierCategory, { category: SupplierCategory; count: number; costoReposicion: Prisma.Decimal }>();
  for (const row of rows) {
    const current = porCategoriaMap.get(row.category) ?? {
      category: row.category,
      count: 0,
      costoReposicion: ZERO,
    };
    current.count++;
    current.costoReposicion = current.costoReposicion.plus(row.costoReposicion ?? ZERO);
    porCategoriaMap.set(row.category, current);
  }

  return {
    asOf,
    rows,
    porCategoria: Array.from(porCategoriaMap.values()).sort((a, b) =>
      b.costoReposicion.comparedTo(a.costoReposicion)
    ),
    itemsSinMinimo,
    totalItems: items.length,
    costoReposicionTotal: sumDecimals(rows.map((r) => r.costoReposicion ?? ZERO)),
  };
}

// ---------------------------------------------------------------------------
// 2b. Valorización de insumos en stock
// ---------------------------------------------------------------------------

export type ValorizacionRow = {
  itemId: string;
  itemSlug: string;
  itemName: string;
  unit: string;
  category: SupplierCategory;
  stock: Prisma.Decimal;
  /** En pesos, por unidad. Null si el insumo no tiene ni compras ni costo en la ficha. */
  unitario: Prisma.Decimal | null;
  valor: Prisma.Decimal | null;
  /** De dónde sale el costo: «última compra del 14/10», «costo de la ficha», «soplado + preforma». */
  origen: string | null;
  /** Un envase sin precio de su preforma: el costo es sólo el soplado. */
  faltaPreforma: string | null;
};

export type ValorizacionReport = {
  /** El día de la foto: el stock hasta ese día, a lo que costaba ese día. */
  asOf: Date;
  /** Por categoría (la de más valor primero) y adentro, el de más valor primero. */
  rows: ValorizacionRow[];
  porCategoria: { category: SupplierCategory; count: number; valor: Prisma.Decimal }[];
  total: Prisma.Decimal;
  /** Con stock pero sin ningún costo: no suman al total y hay que decirlo. */
  sinCosto: number;
};

/**
 * Lo que vale lo que hay en el depósito: el stock de cada insumo a una fecha por lo que costaba ese
 * día, en pesos. El costo es el mismo del margen (`getCostosUnitarios`): la última compra con precio
 * pasada a pesos con su cotización, o el de la ficha si nunca se compró; y un envase vale su soplado
 * más la preforma. Así este total y el costo de lo vendido hablan del mismo número.
 *
 * Quedan afuera los insumos que no llevan stock (se usan al comprarlos) y los que están en cero.
 */
export async function getValorizacionReport(options?: { asOf?: Date }): Promise<ValorizacionReport> {
  const asOf = options?.asOf ?? hoyComoFecha();
  // El día entero: hay movimientos con hora (el stock inicial del 29/09 es de las 3:00).
  const finDelDia = new Date(asOf.getTime() + 24 * 60 * 60 * 1000 - 1);
  const cot = await getCotizador();
  const [items, movimientos, costoDe] = await Promise.all([
    prisma.item.findMany({ where: { llevaStock: true } }),
    prisma.itemMovement.groupBy({ by: ["itemId"], where: { date: { lte: finDelDia } }, _sum: { quantity: true } }),
    getCostosUnitarios(cot),
  ]);
  const stockDe = new Map(movimientos.map((m) => [m.itemId, m._sum.quantity ?? ZERO]));

  const filas: ValorizacionRow[] = [];
  for (const item of items) {
    const stock = toDecimal(stockDe.get(item.id) ?? ZERO);
    if (stock.isZero()) continue;
    const unitario = costoDe(item.id, finDelDia);
    filas.push({
      itemId: item.id,
      itemSlug: item.slug,
      itemName: item.name,
      unit: item.unit,
      category: item.category,
      stock,
      unitario,
      valor: unitario ? stock.times(unitario) : null,
      origen: costoDe.origen(item.id, finDelDia),
      faltaPreforma: costoDe.faltaPreforma(item.id, finDelDia),
    });
  }

  const porCategoriaMap = new Map<SupplierCategory, { category: SupplierCategory; count: number; valor: Prisma.Decimal }>();
  for (const f of filas) {
    const c = porCategoriaMap.get(f.category) ?? { category: f.category, count: 0, valor: ZERO };
    c.count++;
    c.valor = c.valor.plus(f.valor ?? ZERO);
    porCategoriaMap.set(f.category, c);
  }
  const porCategoria = Array.from(porCategoriaMap.values()).sort((a, b) => b.valor.comparedTo(a.valor));
  const orden = new Map(porCategoria.map((c, i) => [c.category, i]));
  filas.sort(
    (a, b) =>
      orden.get(a.category)! - orden.get(b.category)! ||
      (b.valor ?? ZERO).comparedTo(a.valor ?? ZERO) ||
      a.itemName.localeCompare(b.itemName, "es")
  );

  return {
    asOf,
    rows: filas,
    porCategoria,
    total: sumDecimals(filas.map((f) => f.valor ?? ZERO)),
    sinCosto: filas.filter((f) => !f.unitario).length,
  };
}

// ---------------------------------------------------------------------------
// 2c. Cierre del mes: el resultado y cómo cambió el stock
// ---------------------------------------------------------------------------

export type CierreFilaInsumo = {
  itemId: string;
  slug: string;
  nombre: string;
  unidad: string;
  categoria: SupplierCategory;
  inicio: Prisma.Decimal;
  /** Compras e ingresos. */
  entradas: Prisma.Decimal;
  /** Lo que se llevó la producción (y la madera de los armados). Positivo. */
  produccion: Prisma.Decimal;
  /** Lo que se vendió como insumo. Positivo. */
  ventas: Prisma.Decimal;
  /** Mermas anotadas y diferencias de recuento, con signo: lo que apareció suma, lo que faltó resta. */
  mermasYRecuento: Prisma.Decimal;
  cierre: Prisma.Decimal;
  valorInicio: Prisma.Decimal | null;
  valorCierre: Prisma.Decimal | null;
};

export type CierreFilaProducto = {
  clave: string;
  nombre: string;
  /** "5 pallets", "37 cajas + 4 botellas". */
  inicio: string;
  cierre: string;
  valorInicio: Prisma.Decimal | null;
  valorCierre: Prisma.Decimal | null;
};

export type CierreReport = {
  period: Period;
  /** El último día antes del período: la foto con la que se empezó. */
  inicio: Date;
  /** El último día del período, o hoy si el período todavía no terminó. */
  cierre: Date;
  resultado: { ventas: Prisma.Decimal; costo: Prisma.Decimal; margen: Prisma.Decimal; gastos: Prisma.Decimal; resultado: Prisma.Decimal };
  insumos: {
    inicio: Prisma.Decimal;
    cierre: Prisma.Decimal;
    /** La diferencia que es de cantidad: cuánto más o menos hay, al costo del cierre. */
    porCantidad: Prisma.Decimal;
    /** La que es de precio: lo que había al empezar, por cuánto cambió su costo. */
    porPrecio: Prisma.Decimal;
    /** De la de cantidad, lo que no tiene comprobante: mermas y recuentos, al costo del cierre. */
    mermasYRecuento: Prisma.Decimal;
    /** Con stock y sin ningún costo: no suman. */
    sinCosto: number;
    categorias: { category: SupplierCategory; inicio: Prisma.Decimal; cierre: Prisma.Decimal }[];
    filas: CierreFilaInsumo[];
  };
  producto: {
    inicio: Prisma.Decimal;
    cierre: Prisma.Decimal;
    /** Pallets armados al principio y al final, sin las cajas sueltas. */
    pallets: { inicio: Prisma.Decimal; cierre: Prisma.Decimal };
    sinCosto: number;
    filas: CierreFilaProducto[];
  };
};

/**
 * El resumen de fin de mes: si se ganó o se perdió plata, y si el depósito quedó con más o menos de
 * lo que tenía al empezar.
 *
 * El resultado es el de siempre (`getRentabilidad`): ventas menos lo que costó lo vendido, por
 * receta, menos los gastos. Lo que se compró y no se vendió no es gasto: queda en el depósito, como
 * insumo o ya envasado. Por eso el stock va **con el producto terminado**: si se envasó más de lo que
 * se entregó, los insumos bajan y los pallets suben, y mirando sólo los insumos parecería que se
 * perdió.
 *
 * Todo en pesos, con el mismo costo que el margen (`getCostosUnitarios`) en cada punta: el inicio a
 * lo que costaba el último día antes del período, el cierre a lo que cuesta el último día. La
 * diferencia de insumos se parte en cantidad y precio para que una suba de precios no se lea como
 * más stock. El producto terminado vale su receta: el pallet entero, la caja suelta sin el pallet de
 * madera ni el stretch, y la botella suelta sin la caja de cartón.
 */
export async function getCierreReport(period: Period): Promise<CierreReport> {
  const ahora = new Date();
  const hastaFin = period.to < ahora ? period.to : ahora;
  // Un milisegundo antes de cada corte: el costo "de ese día" incluye las compras de ese día.
  const tIni = new Date(period.from.getTime() - 1);
  const tFin = new Date(hastaFin.getTime() - 1);

  const cot = await getCotizador();
  const [rentabilidad, costoDe, items, itemMovs, productos, productMovs, cajas, cajaMovs] = await Promise.all([
    getRentabilidad(period, cot),
    getCostosUnitarios(cot),
    prisma.item.findMany({ where: { llevaStock: true } }),
    prisma.itemMovement.findMany({ where: { date: { lt: period.to } }, select: { itemId: true, date: true, quantity: true, type: true } }),
    prisma.product.findMany({ include: { recipe: { include: { item: { select: { category: true } } } } } }),
    prisma.productMovement.groupBy({ by: ["productId"], where: { date: { lt: period.from } }, _sum: { quantity: true } }).then((ini) =>
      prisma.productMovement
        .groupBy({ by: ["productId"], where: { date: { lt: period.to } }, _sum: { quantity: true } })
        .then((fin) => ({ ini, fin }))
    ),
    prisma.caja.findMany(),
    prisma.cajaMovement.groupBy({ by: ["cajaId"], where: { date: { lt: period.from } }, _sum: { quantity: true, botellas: true } }).then((ini) =>
      prisma.cajaMovement
        .groupBy({ by: ["cajaId"], where: { date: { lt: period.to } }, _sum: { quantity: true, botellas: true } })
        .then((fin) => ({ ini, fin }))
    ),
  ]);

  // ---------- Insumos
  const porItem = new Map<string, typeof itemMovs>();
  for (const m of itemMovs) {
    const lista = porItem.get(m.itemId) ?? [];
    lista.push(m);
    porItem.set(m.itemId, lista);
  }
  const filas: CierreFilaInsumo[] = [];
  let porCantidad = ZERO;
  let porPrecio = ZERO;
  let mermasYRecuentoValor = ZERO;
  let sinCosto = 0;
  for (const item of items) {
    const movs = porItem.get(item.id) ?? [];
    const antes = movs.filter((m) => m.date < period.from);
    const durante = movs.filter((m) => m.date >= period.from);
    const suma = (lista: typeof movs, tipos?: string[]) =>
      sumDecimals(lista.filter((m) => !tipos || tipos.includes(m.type)).map((m) => toDecimal(m.quantity)));
    const inicio = suma(antes);
    const cierre = inicio.plus(suma(durante));
    if (inicio.isZero() && cierre.isZero() && durante.length === 0) continue;

    const cIni = costoDe(item.id, tIni);
    const cFin = costoDe(item.id, tFin);
    const mermasYRecuento = suma(durante, ["MERMA", "AJUSTE"]);
    if (!cFin && !cierre.isZero()) sinCosto++;
    // Sin costo en una punta se usa el de la otra: para la diferencia de cantidad, mejor un costo
    // conocido que dejar afuera el insumo entero.
    const costoCierre = cFin ?? cIni;
    const costoInicio = cIni ?? cFin;
    if (costoCierre) {
      porCantidad = porCantidad.plus(cierre.minus(inicio).times(costoCierre));
      mermasYRecuentoValor = mermasYRecuentoValor.plus(mermasYRecuento.times(costoCierre));
    }
    if (costoCierre && costoInicio) porPrecio = porPrecio.plus(inicio.times(costoCierre.minus(costoInicio)));

    filas.push({
      itemId: item.id,
      slug: item.slug,
      nombre: item.name,
      unidad: item.unit,
      categoria: item.category,
      inicio,
      entradas: suma(durante, ["INGRESO"]),
      produccion: suma(durante, ["CONSUMO_PRODUCCION", "CONSUMO_PALLET"]).negated(),
      ventas: suma(durante, ["VENTA"]).negated(),
      mermasYRecuento,
      cierre,
      valorInicio: costoInicio ? inicio.times(costoInicio) : null,
      valorCierre: costoCierre ? cierre.times(costoCierre) : null,
    });
  }
  const categoriasMap = new Map<SupplierCategory, { category: SupplierCategory; inicio: Prisma.Decimal; cierre: Prisma.Decimal }>();
  for (const f of filas) {
    const c = categoriasMap.get(f.categoria) ?? { category: f.categoria, inicio: ZERO, cierre: ZERO };
    c.inicio = c.inicio.plus(f.valorInicio ?? ZERO);
    c.cierre = c.cierre.plus(f.valorCierre ?? ZERO);
    categoriasMap.set(f.categoria, c);
  }
  const categorias = Array.from(categoriasMap.values()).sort((a, b) => b.cierre.comparedTo(a.cierre));
  const ordenCat = new Map(categorias.map((c, i) => [c.category, i]));
  // Primero lo que más cambió de valor, dentro de cada categoría.
  const cambio = (f: CierreFilaInsumo) => (f.valorCierre ?? ZERO).minus(f.valorInicio ?? ZERO).abs();
  filas.sort((a, b) => ordenCat.get(a.categoria)! - ordenCat.get(b.categoria)! || cambio(b).comparedTo(cambio(a)));

  // ---------- Producto terminado
  const recetaCosto = (receta: (typeof productos)[number]["recipe"], t: Date, filtro: (cat: SupplierCategory) => boolean, dividir = 1) => {
    let total = ZERO;
    for (const r of receta) {
      if (!filtro(r.item.category)) continue;
      const c = costoDe(r.itemId, t);
      if (!c) return null;
      total = total.plus(new Prisma.Decimal(r.quantityPerUnit).times(c));
    }
    return receta.length ? total.dividedBy(dividir) : null;
  };
  const delPallet = (cat: SupplierCategory) => cat !== "PALLET_NORMALIZADO" && cat !== "STRETCH";
  const filasPT: CierreFilaProducto[] = [];
  let sinCostoPT = 0;
  const palletsIni = new Map(productMovs.ini.map((m) => [m.productId, toDecimal(m._sum.quantity ?? ZERO)]));
  const palletsFin = new Map(productMovs.fin.map((m) => [m.productId, toDecimal(m._sum.quantity ?? ZERO)]));
  const totalPallets = { inicio: sumDecimals([...palletsIni.values()]), cierre: sumDecimals([...palletsFin.values()]) };
  for (const p of productos) {
    const ini = palletsIni.get(p.id) ?? ZERO;
    const fin = palletsFin.get(p.id) ?? ZERO;
    if (ini.isZero() && fin.isZero()) continue;
    const cIni = recetaCosto(p.recipe, tIni, () => true);
    const cFin = recetaCosto(p.recipe, tFin, () => true);
    if (!cFin) sinCostoPT++;
    const pallets = (n: Prisma.Decimal) => `${formatQuantity(n)} ${n.abs().equals(1) ? "pallet" : "pallets"}`;
    filasPT.push({
      clave: p.id,
      nombre: `${p.name} ${p.oilType} ${p.presentation}`,
      inicio: pallets(ini),
      cierre: pallets(fin),
      valorInicio: cIni ? ini.times(cIni) : null,
      valorCierre: cFin ? fin.times(cFin) : null,
    });
  }
  const sueltasIni = new Map(cajaMovs.ini.map((m) => [m.cajaId, m._sum]));
  const sueltasFin = new Map(cajaMovs.fin.map((m) => [m.cajaId, m._sum]));
  for (const caja of cajas) {
    const ini = sueltasIni.get(caja.id);
    const fin = sueltasFin.get(caja.id);
    const [ci, bi, cf, bf] = [ini?.quantity ?? 0, ini?.botellas ?? 0, fin?.quantity ?? 0, fin?.botellas ?? 0];
    if (!ci && !bi && !cf && !bf) continue;
    // La caja suelta vale la receta de un pallet de esa caja, dividida por sus cajas y sin lo que es
    // del pallet; la botella suelta, además, sin la caja de cartón.
    const modelo = productos.find((p) => p.cajaId === caja.id && p.recipe.length > 0 && p.boxesPerPallet);
    const valor = (cajasN: number, botellasN: number, t: Date) => {
      if (!modelo) return null;
      const porCaja = recetaCosto(modelo.recipe, t, delPallet, modelo.boxesPerPallet!);
      const porBotella = recetaCosto(modelo.recipe, t, (c) => delPallet(c) && c !== "CAJAS", modelo.boxesPerPallet! * caja.unitsPerBox);
      if (!porCaja || (botellasN && !porBotella)) return null;
      return porCaja.times(cajasN).plus(porBotella ? porBotella.times(botellasN) : ZERO);
    };
    const texto = (c: number, b: number) =>
      [c ? `${formatQuantity(c)} ${Math.abs(c) === 1 ? "caja" : "cajas"}` : "", b ? `${formatQuantity(b)} ${Math.abs(b) === 1 ? "botella" : "botellas"}` : ""]
        .filter(Boolean)
        .join(" + ") || "0";
    const vFin = valor(cf, bf, tFin);
    if (!vFin) sinCostoPT++;
    filasPT.push({
      clave: caja.id,
      nombre: `Sueltas ${caja.name} ${caja.oilType} ${formatQuantity(caja.bottleCapacityMl)} ml`,
      inicio: texto(ci, bi),
      cierre: texto(cf, bf),
      valorInicio: valor(ci, bi, tIni),
      valorCierre: vFin,
    });
  }
  filasPT.sort((a, b) => (b.valorCierre ?? ZERO).comparedTo(a.valorCierre ?? ZERO));

  const margen = rentabilidad.ingresos.minus(rentabilidad.costoInsumos);
  return {
    period,
    inicio: addDays(period.from, -1),
    // Con el período en curso, la foto es de hoy: el último día del período todavía no llegó.
    cierre: period.to < ahora ? periodLastDay(period) : hoyComoFecha(),
    resultado: {
      ventas: rentabilidad.ingresos,
      costo: rentabilidad.costoInsumos,
      margen,
      gastos: rentabilidad.gastos,
      resultado: rentabilidad.rentabilidad,
    },
    insumos: {
      inicio: sumDecimals(filas.map((f) => f.valorInicio ?? ZERO)),
      cierre: sumDecimals(filas.map((f) => f.valorCierre ?? ZERO)),
      porCantidad,
      porPrecio,
      mermasYRecuento: mermasYRecuentoValor,
      sinCosto,
      categorias,
      filas,
    },
    producto: {
      inicio: sumDecimals(filasPT.map((f) => f.valorInicio ?? ZERO)),
      cierre: sumDecimals(filasPT.map((f) => f.valorCierre ?? ZERO)),
      pallets: totalPallets,
      sinCosto: sinCostoPT,
      filas: filasPT,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Ventas / entregas del período
// ---------------------------------------------------------------------------

type VentasAgg = { pallets: Prisma.Decimal; litros: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> };

function emptyAgg(): VentasAgg {
  return { pallets: ZERO, litros: ZERO, byCurrency: new Map() };
}

export type VentasReport = {
  period: Period;
  porCliente: (VentasAgg & { entityName: string; entitySlug: string })[];
  porMarca: (VentasAgg & { marca: string })[];
  porProducto: (VentasAgg & { productSlug: string; label: string })[];
  detalle: {
    number: string;
    date: Date;
    entityName: string;
    circuit: Circuit;
    productLabel: string;
    pallets: Prisma.Decimal;
    litros: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    currency: Currency;
  }[];
  totales: VentasAgg;
  porCircuito: Record<Circuit, VentasAgg>;
};

/**
 * Entregas a clientes del período, abiertas por cliente, marca y producto. Se miran los REMITOs
 * (las facturas duplicarían lo mismo, porque facturan remitos ya contados acá) **menos las
 * devoluciones**: lo que el cliente devolvió se entregó pero no lo compró, así que resta. Una
 * devolución es una nota de crédito con líneas de producto.
 */
export async function getVentasReport(
  period: Period,
  options?: { circuit?: Circuit }
): Promise<VentasReport> {
  const documents = await prisma.document.findMany({
    where: {
      type: { in: ["REMITO", "NOTA_CREDITO"] },
      lines: { some: {} },
      date: { gte: period.from, lt: period.to },
      account: {
        entity: { type: { in: ["CLIENTE", "AMBOS"] } },
        ...(options?.circuit ? { circuit: options.circuit } : {}),
      },
    },
    include: {
      account: { include: { entity: true } },
      lines: { include: { product: { include: { recipe: { include: { item: true } } } } } },
    },
    orderBy: { date: "asc" },
  });
  const cot = await getCotizador();

  const porCliente = new Map<string, VentasAgg & { entityName: string; entitySlug: string }>();
  const porMarca = new Map<string, VentasAgg & { marca: string }>();
  const porProducto = new Map<string, VentasAgg & { productSlug: string; label: string }>();
  const porCircuito: Record<Circuit, VentasAgg> = { BLANCO: emptyAgg(), NEGRO: emptyAgg() };
  const totales = emptyAgg();
  const detalle: VentasReport["detalle"] = [];

  // Lo vendido en dólares (Víctor Dilver) entra en pesos con la cotización del remito o del día.
  let docActual: { currency: Currency; date: Date; exchangeRate: Prisma.Decimal | null } | null = null;
  function accumulate(agg: VentasAgg, pallets: Prisma.Decimal, litros: Prisma.Decimal, currency: Currency, amount: Prisma.Decimal) {
    agg.pallets = agg.pallets.plus(pallets);
    agg.litros = agg.litros.plus(litros);
    addEnPesos(agg.byCurrency, cot, currency, amount, docActual!.date, docActual!.exchangeRate);
  }

  for (const doc of documents) {
    docActual = doc;
    const { entity, circuit } = doc.account;
    const signo = doc.type === "NOTA_CREDITO" ? -1 : 1;
    for (const rawLine of doc.lines) {
      const line = { ...rawLine, subtotal: rawLine.subtotal.times(signo) };
      const pallets = toDecimal(line.quantity).times(signo);
      const litros = litrosDeLinea(line).times(signo);
      const marca = formatProductBrandLabel(line.product);

      const cliente = porCliente.get(entity.slug) ?? { ...emptyAgg(), entityName: entity.name, entitySlug: entity.slug };
      accumulate(cliente, pallets, litros, doc.currency, line.subtotal);
      porCliente.set(entity.slug, cliente);

      const marcaAgg = porMarca.get(marca) ?? { ...emptyAgg(), marca };
      accumulate(marcaAgg, pallets, litros, doc.currency, line.subtotal);
      porMarca.set(marca, marcaAgg);

      const producto = porProducto.get(line.product.slug) ?? {
        ...emptyAgg(),
        productSlug: line.product.slug,
        label: formatProductLabel(line.product),
      };
      accumulate(producto, pallets, litros, doc.currency, line.subtotal);
      porProducto.set(line.product.slug, producto);

      accumulate(porCircuito[circuit], pallets, litros, doc.currency, line.subtotal);
      accumulate(totales, pallets, litros, doc.currency, line.subtotal);

      detalle.push({
        number: signo < 0 ? `${doc.number} (devolución)` : doc.number,
        date: doc.date,
        entityName: entity.name,
        circuit,
        productLabel: formatProductLabel(line.product),
        pallets,
        litros,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        currency: doc.currency,
      });
    }
  }

  const byPallets = <T extends { pallets: Prisma.Decimal }>(a: T, b: T) => b.pallets.comparedTo(a.pallets);

  return {
    period,
    porCliente: Array.from(porCliente.values()).sort(byPallets),
    porMarca: Array.from(porMarca.values()).sort(byPallets),
    porProducto: Array.from(porProducto.values()).sort(byPallets),
    detalle,
    totales,
    porCircuito,
  };
}

// ---------------------------------------------------------------------------
// 4. Cobranzas y pagos del período
// ---------------------------------------------------------------------------

export type CobranzasLado = "CLIENTES" | "PROVEEDORES";

export type CobranzasReport = {
  period: Period;
  lado: CobranzasLado;
  rows: {
    date: Date;
    entityName: string;
    entitySlug: string;
    circuit: Circuit;
    method: PaymentMethod;
    currency: Currency;
    amount: Prisma.Decimal;
    reference: string | null;
    tesoreria: string | null;
    sinImputar: Prisma.Decimal;
  }[];
  porMetodo: { method: PaymentMethod; count: number; byCurrency: Map<Currency, Prisma.Decimal> }[];
  porEntidad: { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }[];
  totales: Map<Currency, Prisma.Decimal>;
};

/**
 * Cuánto tarda cada cliente en pagar: por cada peso cobrado en el período, los días entre el
 * comprobante que canceló (el remito, la factura) y el cobro, promediados por importe. El saldo
 * inicial queda afuera: su fecha es la de la carga, no la de la venta, y bajaría el promedio.
 */
export async function getDiasDeCobro(period: Period) {
  const imputaciones = await prisma.paymentAllocation.findMany({
    where: {
      amount: { gt: 0 },
      payment: {
        date: { gte: period.from, lt: period.to },
        concepto: null,
        account: { entity: { type: { in: ["CLIENTE", "AMBOS"] } } },
      },
      document: { number: { not: NUMERO_SALDO_INICIAL }, type: { in: ["REMITO", "FACTURA", "NOTA_DEBITO"] } },
    },
    select: {
      amount: true,
      payment: {
        select: { date: true, exchangeRate: true, account: { select: { entity: { select: { name: true, slug: true, moneda: true } } } } },
      },
      document: { select: { date: true } },
    },
  });
  // El peso de cada cobro, en pesos: lo de una cuenta en dólares (Víctor Dilver) pesaba como si fueran pesos.
  const cot = await getCotizador();
  const porCliente = new Map<string, { nombre: string; slug: string; importe: number; ponderado: number }>();
  let importe = 0;
  let ponderado = 0;
  for (const i of imputaciones) {
    const dias = Math.max(0, Math.round((i.payment.date.getTime() - i.document.date.getTime()) / MS_POR_DIA));
    const { name, slug, moneda } = i.payment.account.entity;
    const monto = cot.aPesos(i.amount, moneda, i.payment.date, i.payment.exchangeRate).toNumber();
    const c = porCliente.get(slug) ?? { nombre: name, slug, importe: 0, ponderado: 0 };
    c.importe += monto;
    c.ponderado += monto * dias;
    porCliente.set(slug, c);
    importe += monto;
    ponderado += monto * dias;
  }
  return {
    promedio: importe ? Math.round(ponderado / importe) : null,
    porCliente: Array.from(porCliente.values())
      .map((c) => ({ nombre: c.nombre, slug: c.slug, dias: Math.round(c.ponderado / c.importe), importe: c.importe }))
      .sort((a, b) => b.dias - a.dias),
  };
}

export async function getCobranzasReport(period: Period, lado: CobranzasLado): Promise<CobranzasReport> {
  const payments = await prisma.payment.findMany({
    where: {
      date: { gte: period.from, lt: period.to },
      concepto: null,
      account: {
        entity: { type: { in: lado === "CLIENTES" ? ["CLIENTE", "AMBOS"] : ["PROVEEDOR", "AMBOS"] } },
      },
    },
    include: { account: { include: { entity: true } }, allocations: true, treasury: true },
    orderBy: { date: "asc" },
  });
  const cot = await getCotizador();

  const porMetodo = new Map<PaymentMethod, { method: PaymentMethod; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porEntidad = new Map<string, { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const totales = new Map<Currency, Prisma.Decimal>();

  const rows = payments.map((payment) => {
    const { entity, circuit } = payment.account;
    const imputado = sumDecimals(payment.allocations.map((a) => a.amount));
    // Un pago en dólares vale en pesos lo que salió de la caja (`amountArs`), que es exacto; sin eso,
    // la cotización del pago o del día.
    const sumar = (map: Map<Currency, Prisma.Decimal>) => {
      if (payment.currency === "USD" && payment.amountArs) {
        addByCurrency(map, "ARS", payment.amountArs);
        addByCurrency(map, "USD", payment.amount);
      } else addEnPesos(map, cot, payment.currency, payment.amount, payment.date, payment.exchangeRate);
    };

    const metodo = porMetodo.get(payment.method) ?? { method: payment.method, count: 0, byCurrency: new Map() };
    metodo.count++;
    sumar(metodo.byCurrency);
    porMetodo.set(payment.method, metodo);

    const entidad = porEntidad.get(entity.slug) ?? {
      entityName: entity.name,
      entitySlug: entity.slug,
      count: 0,
      byCurrency: new Map(),
    };
    entidad.count++;
    sumar(entidad.byCurrency);
    porEntidad.set(entity.slug, entidad);

    sumar(totales);

    return {
      date: payment.date,
      entityName: entity.name,
      entitySlug: entity.slug,
      circuit,
      method: payment.method,
      currency: payment.currency,
      amount: payment.amount,
      reference: payment.reference,
      tesoreria: payment.treasury?.name ?? null,
      sinImputar: payment.amount.minus(imputado),
    };
  });

  const byArs = (a: { byCurrency: Map<Currency, Prisma.Decimal> }, b: { byCurrency: Map<Currency, Prisma.Decimal> }) =>
    (b.byCurrency.get("ARS") ?? ZERO).comparedTo(a.byCurrency.get("ARS") ?? ZERO);

  return {
    period,
    lado,
    rows,
    porMetodo: Array.from(porMetodo.values()).sort(byArs),
    porEntidad: Array.from(porEntidad.values()).sort(byArs),
    totales,
  };
}

// ---------------------------------------------------------------------------
// 5. Compras de insumos del período
// ---------------------------------------------------------------------------

export type ComprasReport = {
  period: Period;
  /** Por quién cobró: el proveedor de la factura, o la caja de la que salió la plata. */
  porProveedor: { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }[];
  porCategoria: { category: SupplierCategory; byCurrency: Map<Currency, Prisma.Decimal>; qtyByUnit: Map<string, Prisma.Decimal> }[];
  porInsumo: { itemSlug: string; itemName: string; unit: string; quantity: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }[];
  detalle: {
    number: string;
    date: Date;
    entityName: string;
    circuit: Circuit;
    itemName: string;
    quantity: Prisma.Decimal;
    unit: string;
    unitPrice: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    currency: Currency;
  }[];
  /** Suma de los netos de las líneas: es la base de costo, sin IVA. */
  totales: Map<Currency, Prisma.Decimal>;
  /** El IVA de las compras facturadas, que es crédito fiscal y no costo. */
  iva: Map<Currency, Prisma.Decimal>;
  /** Lo que efectivamente se le debe al proveedor: neto + IVA + percepciones − retenciones. */
  totalesConIva: Map<Currency, Prisma.Decimal>;
};

export async function getComprasReport(period: Period): Promise<ComprasReport> {
  const documents = await prisma.document.findMany({
    where: {
      type: "REMITO",
      purchaseLines: { some: {} },
      date: { gte: period.from, lt: period.to },
    },
    include: {
      account: { include: { entity: true } },
      purchaseLines: { include: { item: true } },
    },
    orderBy: { date: "asc" },
  });
  const cot = await getCotizador();

  const porProveedor = new Map<string, { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porCategoria = new Map<SupplierCategory, { category: SupplierCategory; byCurrency: Map<Currency, Prisma.Decimal>; qtyByUnit: Map<string, Prisma.Decimal> }>();
  const porInsumo = new Map<string, { itemSlug: string; itemName: string; unit: string; quantity: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const totales = new Map<Currency, Prisma.Decimal>();
  const iva = new Map<Currency, Prisma.Decimal>();
  const totalesConIva = new Map<Currency, Prisma.Decimal>();
  const detalle: ComprasReport["detalle"] = [];

  for (const doc of documents) {
    const { entity, circuit } = doc.account;
    const enPesos = (monto: Prisma.Decimal | null) => [doc.currency, toDecimal(monto), doc.date, doc.exchangeRate] as const;
    addEnPesos(iva, cot, ...enPesos(doc.ivaAmount));
    addEnPesos(totalesConIva, cot, ...enPesos(doc.totalAmount));

    const proveedor = porProveedor.get(entity.slug) ?? {
      entityName: entity.name,
      entitySlug: entity.slug,
      count: 0,
      byCurrency: new Map(),
    };
    proveedor.count++;

    for (const line of doc.purchaseLines) {
      const quantity = toDecimal(line.quantity);
      addEnPesos(proveedor.byCurrency, cot, ...enPesos(line.subtotal));

      const categoria = porCategoria.get(line.item.category) ?? {
        category: line.item.category,
        byCurrency: new Map(),
        qtyByUnit: new Map(),
      };
      addEnPesos(categoria.byCurrency, cot, ...enPesos(line.subtotal));
      categoria.qtyByUnit.set(line.item.unit, (categoria.qtyByUnit.get(line.item.unit) ?? ZERO).plus(quantity));
      porCategoria.set(line.item.category, categoria);

      const insumo = porInsumo.get(line.item.slug) ?? {
        itemSlug: line.item.slug,
        itemName: line.item.name,
        unit: line.item.unit,
        quantity: ZERO,
        byCurrency: new Map(),
      };
      insumo.quantity = insumo.quantity.plus(quantity);
      addEnPesos(insumo.byCurrency, cot, ...enPesos(line.subtotal));
      porInsumo.set(line.item.slug, insumo);

      addEnPesos(totales, cot, ...enPesos(line.subtotal));

      detalle.push({
        number: doc.number,
        date: doc.date,
        entityName: entity.name,
        circuit,
        itemName: line.item.name,
        quantity,
        unit: line.item.unit,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        currency: doc.currency,
      });
    }

    porProveedor.set(entity.slug, proveedor);
  }

  const byArs = (a: { byCurrency: Map<Currency, Prisma.Decimal> }, b: { byCurrency: Map<Currency, Prisma.Decimal> }) =>
    (b.byCurrency.get("ARS") ?? ZERO).comparedTo(a.byCurrency.get("ARS") ?? ZERO);

  return {
    period,
    porProveedor: Array.from(porProveedor.values()).sort(byArs),
    porCategoria: Array.from(porCategoria.values()).sort(byArs),
    porInsumo: Array.from(porInsumo.values()).sort(byArs),
    detalle,
    totales,
    iva,
    totalesConIva,
  };
}

// ---------------------------------------------------------------------------
// 6. Gastos del período — el esqueleto del libro de IVA compras
// ---------------------------------------------------------------------------

export type GastosReport = {
  period: Period;
  porRubro: { category: ExpenseCategory; count: number; byCurrency: Map<Currency, Prisma.Decimal> }[];
  /** Por quién cobró: el proveedor de la factura, o la caja de la que salió la plata. */
  porProveedor: { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }[];
  /** Un renglón por comprobante, con las columnas que pide el libro de IVA compras. */
  detalle: {
    date: Date;
    number: string;
    entityName: string;
    taxId: string | null;
    circuit: Circuit;
    category: ExpenseCategory | null;
    reason: string | null;
    neto: Prisma.Decimal;
    iva: Prisma.Decimal;
    percepciones: Prisma.Decimal;
    retencion: Prisma.Decimal;
    total: Prisma.Decimal;
    currency: Currency;
  }[];
  /** Neto gravado e IVA abiertos por alícuota, que es lo que se declara. */
  porAlicuota: { rate: Prisma.Decimal; neto: Prisma.Decimal; iva: Prisma.Decimal }[];
  totales: Map<Currency, Prisma.Decimal>;
};

export async function getGastosReport(period: Period): Promise<GastosReport> {
  // Las facturas de gasto de los proveedores y lo que sale de la caja sin factura. Se listan
  // juntos porque es la misma pregunta —en qué se fue la plata este mes— y la caja es justamente
  // por donde salen los sueldos, que es el gasto más grande de todos.
  const documents = await prisma.document.findMany({
    where: { ...GASTOS_WHERE, date: { gte: period.from, lt: period.to } },
    include: { account: { include: { entity: true } }, taxes: true },
    orderBy: { date: "asc" },
  });
  const cot = await getCotizador();

  const porRubro = new Map<ExpenseCategory, { category: ExpenseCategory; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porProveedor = new Map<string, { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porAlicuota = new Map<string, { rate: Prisma.Decimal; neto: Prisma.Decimal; iva: Prisma.Decimal }>();
  const totales = new Map<Currency, Prisma.Decimal>();
  const detalle: GastosReport["detalle"] = [];

  for (const doc of documents) {
    const { entity, circuit } = doc.account;
    const total = costoDelGasto(doc);
    const enPesos = [doc.currency, total, doc.date, doc.exchangeRate] as const;

    // Un impuesto o una comisión cargados como movimiento de tesorería no tienen rubro propio, pero
    // su categoría ya dice de qué son: sin esto sumaban al total del mes sin aparecer en ninguna fila.
    const rubroDelDoc = rubroDelGasto(doc);
    if (rubroDelDoc) {
      const rubro = porRubro.get(rubroDelDoc) ?? {
        category: rubroDelDoc,
        count: 0,
        byCurrency: new Map(),
      };
      rubro.count++;
      addEnPesos(rubro.byCurrency, cot, ...enPesos);
      porRubro.set(rubroDelDoc, rubro);
    }

    const proveedor = porProveedor.get(entity.slug) ?? {
      entityName: entity.name,
      entitySlug: entity.slug,
      count: 0,
      byCurrency: new Map(),
    };
    proveedor.count++;
    addEnPesos(proveedor.byCurrency, cot, ...enPesos);
    porProveedor.set(entity.slug, proveedor);

    for (const tax of doc.taxes) {
      if (tax.kind !== "IVA" || !tax.rate) continue;
      const clave = tax.rate.toString();
      const fila = porAlicuota.get(clave) ?? { rate: tax.rate, neto: ZERO, iva: ZERO };
      fila.neto = fila.neto.plus(toDecimal(tax.base));
      fila.iva = fila.iva.plus(toDecimal(tax.amount));
      porAlicuota.set(clave, fila);
    }

    addEnPesos(totales, cot, ...enPesos);

    detalle.push({
      date: doc.date,
      number: doc.number,
      entityName: entity.name,
      taxId: entity.taxId,
      circuit,
      category: rubroDelDoc,
      reason: doc.reason,
      neto: toDecimal(doc.netAmount),
      iva: toDecimal(doc.ivaAmount),
      percepciones: toDecimal(doc.perceptionAmount),
      retencion: toDecimal(doc.retentionAmount),
      total,
      currency: doc.currency,
    });
  }

  const byArs = (a: { byCurrency: Map<Currency, Prisma.Decimal> }, b: { byCurrency: Map<Currency, Prisma.Decimal> }) =>
    (b.byCurrency.get("ARS") ?? ZERO).comparedTo(a.byCurrency.get("ARS") ?? ZERO);

  return {
    period,
    porRubro: Array.from(porRubro.values()).sort(byArs),
    porProveedor: Array.from(porProveedor.values()).sort(byArs),
    detalle,
    porAlicuota: Array.from(porAlicuota.values()).sort((a, b) => b.rate.comparedTo(a.rate)),
    totales,
  };
}

// ---------------------------------------------------------------------------
// 7. Producción del período
// ---------------------------------------------------------------------------

export type ProduccionReport = {
  period: Period;
  porProducto: {
    productSlug: string;
    label: string;
    pallets: Prisma.Decimal;
    botellas: Prisma.Decimal;
  }[];
  corridas: { date: Date; notes: string | null; lines: { label: string; pallets: Prisma.Decimal }[] }[];
  litrosEnvasados: Prisma.Decimal;
  costoInsumos: Awaited<ReturnType<typeof getCostoInsumos>>;
  totalPallets: Prisma.Decimal;
};

export async function getProduccionReport(period: Period): Promise<ProduccionReport> {
  const [runs, costoInsumos] = await Promise.all([
    prisma.productionRun.findMany({
      where: { date: { gte: period.from, lt: period.to } },
      include: { lines: { include: { product: true } } },
      orderBy: { date: "asc" },
    }),
    getCostoInsumos(period),
  ]);

  const porProducto = new Map<string, { productSlug: string; label: string; pallets: Prisma.Decimal; botellas: Prisma.Decimal }>();
  let totalPallets = ZERO;

  // Lo envasado, en pallets: los pallets terminados más las cajas sueltas pasadas a pallets
  // (48 cajas de un pallet de 105 son 0,457). Armar y desarmar no es producir —las botellas ya
  // estaban—, así que no suma.
  const enPallets = (line: (typeof runs)[number]["lines"][number]) => {
    if (line.tipo === "PALLETS") return toDecimal(line.quantity);
    if (line.tipo === "CAJAS" && line.product.boxesPerPallet) {
      return toDecimal(line.quantity).dividedBy(line.product.boxesPerPallet);
    }
    return null;
  };

  for (const run of runs) {
    for (const line of run.lines) {
      const pallets = enPallets(line);
      if (!pallets) continue;
      const porPallet = (line.product.boxesPerPallet ?? 0) * (line.product.unitsPerBox ?? 0);
      const current = porProducto.get(line.product.slug) ?? {
        productSlug: line.product.slug,
        label: formatProductLabel(line.product),
        pallets: ZERO,
        botellas: ZERO,
      };
      current.pallets = current.pallets.plus(pallets);
      current.botellas = current.botellas.plus(pallets.times(porPallet));
      porProducto.set(line.product.slug, current);
      totalPallets = totalPallets.plus(pallets);
    }
  }

  // Litros envasados = aceite consumido en el período (los insumos medidos en "L").
  const litrosEnvasados = sumDecimals(
    costoInsumos.porItem.filter((r) => r.item.unit === "L").map((r) => r.cantidad)
  );

  return {
    period,
    porProducto: Array.from(porProducto.values()).sort((a, b) => b.pallets.comparedTo(a.pallets)),
    corridas: runs.map((run) => ({
      date: run.date,
      notes: run.notes,
      lines: run.lines.flatMap((l) => {
        const pallets = enPallets(l);
        return pallets ? [{ label: formatProductLabel(l.product), pallets }] : [];
      }),
    })),
    litrosEnvasados,
    costoInsumos,
    totalPallets,
  };
}

// ---------------------------------------------------------------------------
// 8. Resultado del período
// ---------------------------------------------------------------------------

export type ResultadoMes = {
  /** "Septiembre 2026". */
  label: string;
  from: Date;
  ventas: Prisma.Decimal;
  costoInsumos: Prisma.Decimal;
  gastos: Prisma.Decimal;
  resultado: Prisma.Decimal;
};

export type ResultadoReport = {
  period: Period;
  /** La cascada del período elegido: ventas − insumos = margen bruto − gastos = resultado. */
  ventas: Prisma.Decimal;
  costoInsumos: Prisma.Decimal;
  margenBruto: Prisma.Decimal;
  gastos: Prisma.Decimal;
  resultado: Prisma.Decimal;
  /** En qué se fueron los gastos del período. Sin rubro van juntos al final. */
  porRubro: { category: ExpenseCategory | null; total: Prisma.Decimal }[];
  /** Los últimos meses cerrados hasta el del período, para ver si mejora o empeora. */
  meses: ResultadoMes[];
  /**
   * Lo que se llevaron los socios **en el período**, más el acumulado como referencia. No es gasto
   * ni resta del resultado: es reparto de lo ganado, y se muestra para que no parezca que esa plata
   * sigue en la empresa.
   */
  retiros: {
    nombre: string;
    moneda: Currency;
    /** Lo que se le dio en el período. */
    retirado: Prisma.Decimal;
    /** Lo que puso (aporte de capital). */
    aportado: Prisma.Decimal;
    /** Lo que se le descontó con comprobantes: el aceite que entregó, las facturas de honorarios. */
    descontado: Prisma.Decimal;
    /** Cuánto cambió el saldo a favor: retirado − aportado − descontado. */
    delPeriodo: Prisma.Decimal;
    acumulado: Prisma.Decimal;
  }[];
  /** Lo vendido de insumos (ya sumado en ventas) y lo que costó (ya sumado en costo). */
  ventasDeInsumos: { ventas: Prisma.Decimal; costo: Prisma.Decimal; cantidad: number; sinCostoConocido: number };
  /** Lo que el número NO está contando, para que se pueda discutir. */
  avisos: { itemsSinCosto: number; facturasSinCompra: { count: number; total: Prisma.Decimal } };
};

const MESES_DEL_COMPARATIVO = 6;

/**
 * Cuánto se ganó: ventas menos lo que costó producirlas menos los gastos, todo neto de IVA y en
 * pesos. Es la misma cuenta que la tarjeta del dashboard —`getRentabilidad`— abierta por rubro y
 * repetida mes a mes, que es lo que no se podía ver en ningún lado.
 *
 * Lo que está en dólares entra en pesos con la cotización del día (`lib/cotizaciones`).
 */
export async function getResultadoReport(period: Period): Promise<ResultadoReport> {
  // Una sola vez: las siete cuentas de abajo (el período y los seis meses) usan las mismas cotizaciones.
  const cot = await getCotizador();
  const [actual, gastos, retirados] = await Promise.all([
    getRentabilidad(period, cot),
    prisma.document.findMany({
      where: { ...GASTOS_WHERE, date: { gte: period.from, lt: period.to } },
      select: {
        type: true,
        netAmount: true,
        totalAmount: true,
        ivaAmount: true,
        taxes: { select: { kind: true, amount: true } },
        expenseCategory: true,
        treasuryCategory: true,
        currency: true,
        date: true,
        exchangeRate: true,
      },
    }),
    getRetirosDelPeriodo(period),
  ]);

  // Sólo las cuentas donde efectivamente se retiró algo este mes: el acumulado se muestra al lado,
  // pero una fila en cero no dice nada.
  const retiros = retirados.filter((r) => !r.retirado.isZero() || !r.aportado.isZero() || !r.descontado.isZero());

  const porRubro = new Map<ExpenseCategory | null, Prisma.Decimal>();
  for (const doc of gastos) {
    const rubro = rubroDelGasto(doc);
    porRubro.set(rubro, (porRubro.get(rubro) ?? ZERO).plus(cot.aPesos(costoDelGasto(doc), doc.currency, doc.date, doc.exchangeRate)));
  }

  // El mes del período es el del último día incluido: con "este mes" elegido, el `to` exclusivo cae
  // en el primero del siguiente y el comparativo arrancaría corrido.
  const ultimo = periodLastDay(period);
  // Los seis meses a la vez: uno detrás del otro, la pantalla tardaba lo que suman los seis.
  const periodos = Array.from({ length: MESES_DEL_COMPARATIVO }, (_, k) =>
    monthPeriod(new Date(Date.UTC(ultimo.getUTCFullYear(), ultimo.getUTCMonth() - (MESES_DEL_COMPARATIVO - 1 - k), 1)))
  );
  const meses: ResultadoMes[] = await Promise.all(
    periodos.map(async (mes) => {
      const r = await getRentabilidad(mes, cot);
      return {
        label: mes.from.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }),
        from: mes.from,
        ventas: r.ingresos,
        costoInsumos: r.costoInsumos,
        gastos: r.gastos,
        resultado: r.rentabilidad,
      };
    })
  );

  return {
    period,
    ventas: actual.ingresos,
    costoInsumos: actual.costoInsumos,
    margenBruto: actual.ingresos.minus(actual.costoInsumos),
    gastos: actual.gastos,
    resultado: actual.rentabilidad,
    porRubro: Array.from(porRubro.entries())
      .map(([category, total]) => ({ category, total }))
      // De mayor a menor, que es como se mira "en qué se me fue la plata"; los sin rubro al final.
      .sort((a, b) => (a.category === null ? 1 : b.category === null ? -1 : b.total.comparedTo(a.total))),
    meses,
    retiros,
    ventasDeInsumos: actual.ventasDeInsumos,
    avisos: { itemsSinCosto: actual.itemsSinCosto, facturasSinCompra: actual.facturasSinCompra },
  };
}

// ---------------------------------------------------------------------------
// 9. Stock — de dónde salió cada movimiento entre dos recuentos
// ---------------------------------------------------------------------------

/**
 * Un movimiento cuyo motivo dice que salió de contar el depósito, no de una operación. «Stock
 * inicial» a secas no: es el saldo con el que se da de alta un insumo nuevo (las planchas, el 8/10),
 * y contado como recuento el reporte decía «Último recuento: 8/10, 1 insumo». El del arranque dice
 * «Stock inicial — recuento del 30/09», así que entra por «recuento».
 */
const ES_DE_RECUENTO = ["recuento", "conteo"];

function esDeRecuento(reason: string) {
  const texto = reason.toLowerCase();
  return ES_DE_RECUENTO.some((marca) => texto.includes(marca));
}

export type StockReportRow = {
  id: string;
  slug: string;
  nombre: string;
  unidad: string;
  /** Sólo en producto terminado, para mostrar las cajas sueltas en vez de una fracción. */
  boxesPerPallet: number | null;
  categoria: string;
  inicial: Prisma.Decimal;
  ingresos: Prisma.Decimal;
  /** Lo que se llevó la producción (o las entregas, en producto terminado). Siempre positivo. */
  consumo: Prisma.Decimal;
  mermas: Prisma.Decimal;
  /** Lo que apareció (+) o faltó (−) al contar. Es la diferencia que nadie explicó. */
  ajustes: Prisma.Decimal;
  ventas: Prisma.Decimal;
  final: Prisma.Decimal;
};

export type StockReport = {
  period: Period;
  /** Las fechas en que se contó el depósito, de la más nueva a la más vieja. */
  recuentos: { fecha: Date; insumos: number; productos: number }[];
  insumos: StockReportRow[];
  productos: StockReportRow[];
  /** Lo que no cierra: la suma de las diferencias de recuento del período. */
  totalAjustes: { insumos: number; productos: number };
};

/**
 * Qué pasó con el stock en el período, renglón por renglón.
 *
 * La gracia está en la columna de **ajustes**: todo lo demás —ingresos, consumo, mermas, ventas—
 * tiene un comprobante detrás que lo explica. El ajuste es lo que apareció de más o de menos al
 * contar, o sea la merma que nadie registró. Entre dos recuentos, esa columna es la respuesta a
 * "¿cuánto se perdió sin que lo anotáramos?".
 *
 * No hace falta un modelo de "recuento": un recuento **es** un puñado de ajustes con la misma
 * fecha, y de ahí sale la lista de arriba.
 */
export async function getStockReport(period: Period): Promise<StockReport> {
  const [items, productos, itemMovs, productMovs, cajas, cajaMovs] = await Promise.all([
    prisma.item.findMany({ where: { llevaStock: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.product.findMany({ orderBy: [{ name: "asc" }, { oilType: "asc" }] }),
    prisma.itemMovement.findMany({ where: { date: { lt: period.to } } }),
    prisma.productMovement.findMany({ where: { date: { lt: period.to } } }),
    prisma.caja.findMany({ orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }] }),
    prisma.cajaMovement.findMany({ where: { date: { lt: period.to } } }),
  ]);

  const enElPeriodo = <T extends { date: Date }>(m: T) => m.date >= period.from;

  const filaDeItem = (item: (typeof items)[number]): StockReportRow => {
    const movs = itemMovs.filter((m) => m.itemId === item.id);
    const delPeriodo = movs.filter(enElPeriodo);
    const suma = (tipos: string[]) =>
      sumDecimals(delPeriodo.filter((m) => tipos.includes(m.type)).map((m) => toDecimal(m.quantity)));
    const inicial = sumDecimals(movs.filter((m) => !enElPeriodo(m)).map((m) => toDecimal(m.quantity)));
    return {
      id: item.id,
      slug: item.slug,
      nombre: item.name,
      unidad: item.unit,
      boxesPerPallet: null,
      categoria: item.category,
      inicial,
      ingresos: suma(["INGRESO"]),
      consumo: suma(["CONSUMO_PRODUCCION", "CONSUMO_PALLET"]).negated(),
      mermas: suma(["MERMA"]),
      ajustes: suma(["AJUSTE"]),
      ventas: suma(["VENTA"]).negated(),
      final: inicial.plus(sumDecimals(delPeriodo.map((m) => toDecimal(m.quantity)))),
    };
  };

  const filaDeProducto = (prod: (typeof productos)[number]): StockReportRow => {
    const movs = productMovs.filter((m) => m.productId === prod.id);
    const delPeriodo = movs.filter(enElPeriodo);
    const suma = (tipos: string[]) =>
      sumDecimals(delPeriodo.filter((m) => tipos.includes(m.type)).map((m) => toDecimal(m.quantity)));
    const inicial = sumDecimals(movs.filter((m) => !enElPeriodo(m)).map((m) => toDecimal(m.quantity)));
    return {
      id: prod.id,
      slug: prod.slug,
      nombre: `${formatProductBrandLabel(prod)} — ${prod.presentation}`,
      unidad: "pallets",
      boxesPerPallet: prod.boxesPerPallet,
      categoria: "PRODUCTO",
      inicial,
      // Lo que entró: lo producido y el armado neto (armar suma pallets, desarmar resta). Lo
      // devuelto resta de lo entregado: se entregó, pero el cliente no lo compró. Así la fila
      // cierra sola contra el final.
      ingresos: suma(["PRODUCCION", "ARMADO", "DESARMADO"]),
      consumo: suma(["ENTREGA", "DEVOLUCION", "CONSUMO_ARMADO_CAJA"]).negated(),
      mermas: suma(["MERMA"]),
      ajustes: suma(["AJUSTE"]),
      ventas: ZERO,
      final: inicial.plus(sumDecimals(delPeriodo.map((m) => toDecimal(m.quantity)))),
    };
  };

  // Las cajas sueltas, por caja, con las mismas columnas que los pallets.
  const filaDeCaja = (caja: (typeof cajas)[number]): StockReportRow => {
    const movs = cajaMovs.filter((m) => m.cajaId === caja.id);
    const delPeriodo = movs.filter(enElPeriodo);
    const suma = (tipos: string[]) =>
      toDecimal(delPeriodo.filter((m) => tipos.includes(m.type)).reduce((a, m) => a + m.quantity, 0));
    const inicial = toDecimal(movs.filter((m) => !enElPeriodo(m)).reduce((a, m) => a + m.quantity, 0));
    return {
      id: caja.id,
      slug: "",
      nombre: `Cajas sueltas — ${caja.name} ${caja.oilType} ${caja.unitsPerBox}x${formatQuantity(caja.bottleCapacityMl)}`,
      unidad: "cajas",
      boxesPerPallet: null,
      categoria: "CAJA",
      inicial,
      ingresos: suma(["PRODUCCION", "ARMADO", "DESARMADO"]),
      consumo: suma(["ENTREGA", "DEVOLUCION"]).negated(),
      mermas: suma(["MERMA"]),
      ajustes: suma(["AJUSTE"]),
      ventas: ZERO,
      final: inicial.plus(toDecimal(delPeriodo.reduce((a, m) => a + m.quantity, 0))),
    };
  };

  // Un recuento es un día en el que se contó: se agrupa por fecha, mirando el motivo.
  const porFecha = new Map<string, { fecha: Date; insumos: number; productos: number }>();
  for (const m of itemMovs) {
    if (!esDeRecuento(m.reason)) continue;
    const clave = m.date.toISOString().slice(0, 10);
    const fila = porFecha.get(clave) ?? { fecha: m.date, insumos: 0, productos: 0 };
    fila.insumos += 1;
    porFecha.set(clave, fila);
  }
  for (const m of productMovs) {
    if (!esDeRecuento(m.reason)) continue;
    const clave = m.date.toISOString().slice(0, 10);
    const fila = porFecha.get(clave) ?? { fecha: m.date, insumos: 0, productos: 0 };
    fila.productos += 1;
    porFecha.set(clave, fila);
  }

  const insumos = items.map(filaDeItem);
  const productosFilas = [...productos.map(filaDeProducto), ...cajas.map(filaDeCaja)];

  return {
    period,
    recuentos: Array.from(porFecha.values()).sort((a, b) => b.fecha.getTime() - a.fecha.getTime()),
    insumos,
    productos: productosFilas,
    totalAjustes: {
      insumos: insumos.filter((f) => !f.ajustes.isZero()).length,
      productos: productosFilas.filter((f) => !f.ajustes.isZero()).length,
    },
  };
}

// ---------------------------------------------------------------------------
// 10. Costo por botella — lo que cuesta cada presentación, insumo por insumo
// ---------------------------------------------------------------------------

/** Las partes de una botella, en el orden en que se piensa: lo de adentro, el envase, lo de afuera. */
export const PARTES_DE_LA_BOTELLA = ["Aceite", "Envase", "Tapa", "Etiqueta", "Caja", "Pallet", "Otros"] as const;
export type ParteDeLaBotella = (typeof PARTES_DE_LA_BOTELLA)[number];

function parteDe(category: SupplierCategory): ParteDeLaBotella {
  switch (category) {
    case "ACEITE":
      return "Aceite";
    case "ENVASES":
    case "PREFORMAS":
      return "Envase";
    case "TAPAS":
      return "Tapa";
    case "ETIQUETAS":
      return "Etiqueta";
    case "CAJAS":
      return "Caja";
    case "PALLET_NORMALIZADO":
      return "Pallet";
    default:
      return "Otros";
  }
}

export type CostoBotellaProducto = {
  productSlug: string;
  label: string;
  formato: string;
  /** Lo que cuesta una botella, por parte, con lo que se sabe. */
  partes: Record<ParteDeLaBotella, Prisma.Decimal>;
  /** Las partes a las que les falta el costo de algún insumo: su número, y el total, quedan cortos. */
  incompletas: ParteDeLaBotella[];
  total: Prisma.Decimal;
  /** Los insumos de la receta que no tienen ni costo en la ficha ni compra cargada. */
  sinCosto: string[];
  /** Lo que se vendió del producto en el período, neto de IVA y en pesos. */
  vendidas: Prisma.Decimal;
  precioPromedio: Prisma.Decimal | null;
  /** Si alguna vez se fabricó, se vendió o tuvo stock. Los del catálogo que todavía no se hacen
   * (el 3600, el Mezcla) van aparte y lo que les falta no se pide. */
  activo: boolean;
};

export type CostoBotellaReport = {
  period: Period;
  /** El día al que están valuados los insumos: el último del período o hoy, lo que sea antes. */
  valuadoAl: Date;
  presentaciones: { capacidadMl: number | null; productos: CostoBotellaProducto[] }[];
  /** Los insumos que hay que costear para que las botellas den completas, con cuántas recetas usan. */
  faltan: { name: string; slug: string | null; productos: number }[];
};

/**
 * Lo que cuesta una botella de cada producto, abierto por parte: la receta del pallet dividida por
 * las botellas del pallet, con cada insumo a lo que costaba ese día (`getCostosUnitarios`: la ficha o
 * la última compra, en pesos, y el envase con su preforma). Al lado, el precio promedio al que se
 * vendió en el período, para ver cuánto deja cada botella.
 */
export async function getCostoBotellaReport(period: Period): Promise<CostoBotellaReport> {
  const hoy = new Date();
  const ultimo = periodLastDay(period);
  const valuadoAl = ultimo < hoy ? ultimo : hoy;
  const cot = await getCotizador();
  const [productos, costoDe, lineas] = await Promise.all([
    prisma.product.findMany({
      where: { recipe: { some: {} } },
      include: {
        recipe: { include: { item: true } },
        _count: { select: { productionLines: true, documentLines: true, movements: true } },
      },
      orderBy: [{ bottleCapacityMl: "asc" }, { name: "asc" }, { presentation: "asc" }],
    }),
    getCostosUnitarios(cot),
    prisma.documentLine.findMany({
      where: {
        document: {
          type: { in: ["REMITO", "NOTA_CREDITO"] },
          date: { gte: period.from, lt: period.to },
          account: { entity: { type: { in: ["CLIENTE", "AMBOS"] } } },
        },
      },
      select: {
        productId: true,
        quantity: true,
        subtotal: true,
        document: { select: { type: true, currency: true, date: true, exchangeRate: true } },
      },
    }),
  ]);

  const slugPorNombre = new Map(
    (await prisma.item.findMany({ select: { name: true, slug: true } })).map((i) => [i.name, i.slug])
  );
  const faltan = new Map<string, number>();
  const presentaciones = new Map<number | null, CostoBotellaProducto[]>();
  for (const producto of productos) {
    const porPallet = (producto.boxesPerPallet ?? 0) * (producto.unitsPerBox ?? 0);
    if (!porPallet) continue;
    const partes = Object.fromEntries(PARTES_DE_LA_BOTELLA.map((p) => [p, ZERO])) as Record<ParteDeLaBotella, Prisma.Decimal>;
    const incompletas = new Set<ParteDeLaBotella>();
    const sinCosto: string[] = [];
    for (const r of producto.recipe) {
      const parte = parteDe(r.item.category);
      const unitario = costoDe(r.itemId, valuadoAl);
      const preformaQueFalta = costoDe.faltaPreforma(r.itemId, valuadoAl);
      if (preformaQueFalta) {
        sinCosto.push(preformaQueFalta);
        incompletas.add(parte);
      }
      if (!unitario) {
        sinCosto.push(r.item.name);
        incompletas.add(parte);
        continue;
      }
      partes[parte] = partes[parte].plus(r.quantityPerUnit.times(unitario).dividedBy(porPallet));
    }
    const total = sumDecimals(PARTES_DE_LA_BOTELLA.map((p) => partes[p]));
    const activo = producto._count.productionLines + producto._count.documentLines + producto._count.movements > 0;
    if (activo) for (const nombre of new Set(sinCosto)) faltan.set(nombre, (faltan.get(nombre) ?? 0) + 1);

    let vendidas = ZERO;
    let vendido = ZERO;
    for (const l of lineas) {
      if (l.productId !== producto.id) continue;
      // Lo entregado en $ 0 no es una venta de este período: San Joaquín, que se facturó y cobró en
      // julio y se retiró el 27/10, se carga así. Contarlo bajaba el precio promedio a nada.
      if (toDecimal(l.subtotal).isZero()) continue;
      const signo = l.document.type === "NOTA_CREDITO" ? -1 : 1;
      vendidas = vendidas.plus(toDecimal(l.quantity).times(porPallet).times(signo));
      vendido = vendido.plus(cot.aPesos(l.subtotal, l.document.currency, l.document.date, l.document.exchangeRate).times(signo));
    }

    const capacidad = producto.bottleCapacityMl ? producto.bottleCapacityMl.toNumber() : null;
    const lista = presentaciones.get(capacidad) ?? [];
    lista.push({
      productSlug: producto.slug,
      label: formatProductBrandLabel(producto),
      formato: producto.presentation,
      partes,
      incompletas: PARTES_DE_LA_BOTELLA.filter((p) => incompletas.has(p)),
      total,
      sinCosto,
      vendidas,
      precioPromedio: vendidas.greaterThan(0) ? vendido.dividedBy(vendidas) : null,
      activo,
    });
    presentaciones.set(capacidad, lista);
  }

  return {
    period,
    valuadoAl,
    presentaciones: Array.from(presentaciones.entries())
      .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
      .map(([capacidadMl, productos]) => ({
        capacidadMl,
        // Lo que más se vendió arriba: es lo que más pesa en el margen.
        productos: productos.sort((x, y) => y.vendidas.comparedTo(x.vendidas) || x.label.localeCompare(y.label, "es")),
      })),
    // Los que más recetas destraban, primero: cargar uno solo completa muchas botellas.
    faltan: Array.from(faltan.entries())
      .map(([name, productos]) => ({ name, slug: slugPorNombre.get(name) ?? null, productos }))
      .sort((a, b) => b.productos - a.productos || a.name.localeCompare(b.name, "es")),
  };
}
