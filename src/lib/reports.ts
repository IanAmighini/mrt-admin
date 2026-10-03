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
import { getCostoInsumos, getRentabilidad } from "@/lib/dashboard-kpis";
import { GASTOS_WHERE, montoDelGasto, rubroDelGasto } from "@/lib/caja";
import { getAllItemStocks } from "@/lib/stock";
import { formatProductBrandLabel, formatProductLabel } from "@/lib/product-label";
import { monthPeriod, periodLastDay, type Period } from "@/lib/period";

export const REPORT_KEYS = [
  "remitos-vencidos",
  "insumos-bajo-minimo",
  "ventas",
  "cobranzas",
  "compras",
  "gastos",
  "resultado",
  "produccion",
  "stock",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_LABELS: Record<ReportKey, string> = {
  "remitos-vencidos": "Remitos vencidos",
  "insumos-bajo-minimo": "Insumos bajo mínimo",
  ventas: "Ventas / entregas",
  cobranzas: "Cobranzas y pagos",
  compras: "Compras de insumos",
  gastos: "Gastos",
  resultado: "Resultado del mes",
  produccion: "Producción",
  stock: "Stock y recuentos",
};

/** Reportes que son una foto del momento y no de un período: el nombre del archivo lleva "al <fecha>". */
export const REPORT_KEYS_SNAPSHOT: ReportKey[] = ["remitos-vencidos", "insumos-bajo-minimo"];

export function isReportKey(value: string | undefined): value is ReportKey {
  return REPORT_KEYS.includes(value as ReportKey);
}

/** Suma `amount` en el mapa por moneda (los importes nunca se mezclan entre monedas). */
function addByCurrency(map: Map<Currency, Prisma.Decimal>, currency: Currency, amount: Prisma.Decimal) {
  map.set(currency, (map.get(currency) ?? ZERO).plus(amount));
}

// ---------------------------------------------------------------------------
// 1. Remitos vencidos impagos — "a hoy", no lleva período
// ---------------------------------------------------------------------------

export const VENCIDO_BUCKETS = ["1-15", "16-30", "31-60", "60+"] as const;
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
    if (!doc.dueDate || doc.dueDate >= asOf) continue;
    if (doc.account.entity.type === "TESORERIA") continue;
    if (options?.circuit && doc.account.circuit !== options.circuit) continue;

    const diasAtraso = Math.floor((asOf.getTime() - doc.dueDate.getTime()) / MS_POR_DIA);
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
      bucket: bucketDe(diasAtraso),
      currency: doc.currency,
      total: doc.totalAmount,
      pendiente: doc.pending,
    });
  }

  rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  const totalPendiente = new Map<Currency, Prisma.Decimal>();
  const porClienteMap = new Map<string, { entityName: string; entitySlug: string; count: number; pendiente: Prisma.Decimal }>();
  const porBucketMap = new Map<VencidoBucket, { bucket: VencidoBucket; count: number; pendiente: Prisma.Decimal }>();

  for (const row of rows) {
    addByCurrency(totalPendiente, row.currency, row.pendiente);

    const cliente = porClienteMap.get(row.entitySlug) ?? {
      entityName: row.entityName,
      entitySlug: row.entitySlug,
      count: 0,
      pendiente: ZERO,
    };
    cliente.count++;
    cliente.pendiente = cliente.pendiente.plus(row.pendiente);
    porClienteMap.set(row.entitySlug, cliente);

    const bucket = porBucketMap.get(row.bucket) ?? { bucket: row.bucket, count: 0, pendiente: ZERO };
    bucket.count++;
    bucket.pendiente = bucket.pendiente.plus(row.pendiente);
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
  const [items, stocks] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    getAllItemStocks(),
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
      unitCost: item.unitCost,
      costoReposicion: item.unitCost ? faltante.times(item.unitCost) : null,
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
 * Entregas a clientes del período, abiertas por cliente, marca y producto. Se miran solo los
 * REMITOs (las facturas duplicarían lo mismo, porque facturan remitos ya contados acá).
 */
export async function getVentasReport(
  period: Period,
  options?: { circuit?: Circuit }
): Promise<VentasReport> {
  const documents = await prisma.document.findMany({
    where: {
      type: "REMITO",
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

  const porCliente = new Map<string, VentasAgg & { entityName: string; entitySlug: string }>();
  const porMarca = new Map<string, VentasAgg & { marca: string }>();
  const porProducto = new Map<string, VentasAgg & { productSlug: string; label: string }>();
  const porCircuito: Record<Circuit, VentasAgg> = { BLANCO: emptyAgg(), NEGRO: emptyAgg() };
  const totales = emptyAgg();
  const detalle: VentasReport["detalle"] = [];

  function accumulate(agg: VentasAgg, pallets: Prisma.Decimal, litros: Prisma.Decimal, currency: Currency, amount: Prisma.Decimal) {
    agg.pallets = agg.pallets.plus(pallets);
    agg.litros = agg.litros.plus(litros);
    addByCurrency(agg.byCurrency, currency, amount);
  }

  for (const doc of documents) {
    const { entity, circuit } = doc.account;
    for (const line of doc.lines) {
      const pallets = toDecimal(line.quantity);
      const litros = litrosDeLinea(line);
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
        number: doc.number,
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

export async function getCobranzasReport(period: Period, lado: CobranzasLado): Promise<CobranzasReport> {
  const payments = await prisma.payment.findMany({
    where: {
      date: { gte: period.from, lt: period.to },
      account: {
        entity: { type: { in: lado === "CLIENTES" ? ["CLIENTE", "AMBOS"] : ["PROVEEDOR", "AMBOS"] } },
      },
    },
    include: { account: { include: { entity: true } }, allocations: true, treasury: true },
    orderBy: { date: "asc" },
  });

  const porMetodo = new Map<PaymentMethod, { method: PaymentMethod; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porEntidad = new Map<string, { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const totales = new Map<Currency, Prisma.Decimal>();

  const rows = payments.map((payment) => {
    const { entity, circuit } = payment.account;
    const imputado = sumDecimals(payment.allocations.map((a) => a.amount));

    const metodo = porMetodo.get(payment.method) ?? { method: payment.method, count: 0, byCurrency: new Map() };
    metodo.count++;
    addByCurrency(metodo.byCurrency, payment.currency, payment.amount);
    porMetodo.set(payment.method, metodo);

    const entidad = porEntidad.get(entity.slug) ?? {
      entityName: entity.name,
      entitySlug: entity.slug,
      count: 0,
      byCurrency: new Map(),
    };
    entidad.count++;
    addByCurrency(entidad.byCurrency, payment.currency, payment.amount);
    porEntidad.set(entity.slug, entidad);

    addByCurrency(totales, payment.currency, payment.amount);

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

  const porProveedor = new Map<string, { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porCategoria = new Map<SupplierCategory, { category: SupplierCategory; byCurrency: Map<Currency, Prisma.Decimal>; qtyByUnit: Map<string, Prisma.Decimal> }>();
  const porInsumo = new Map<string, { itemSlug: string; itemName: string; unit: string; quantity: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const totales = new Map<Currency, Prisma.Decimal>();
  const iva = new Map<Currency, Prisma.Decimal>();
  const totalesConIva = new Map<Currency, Prisma.Decimal>();
  const detalle: ComprasReport["detalle"] = [];

  for (const doc of documents) {
    const { entity, circuit } = doc.account;
    addByCurrency(iva, doc.currency, toDecimal(doc.ivaAmount));
    addByCurrency(totalesConIva, doc.currency, toDecimal(doc.totalAmount));

    const proveedor = porProveedor.get(entity.slug) ?? {
      entityName: entity.name,
      entitySlug: entity.slug,
      count: 0,
      byCurrency: new Map(),
    };
    proveedor.count++;

    for (const line of doc.purchaseLines) {
      const quantity = toDecimal(line.quantity);
      addByCurrency(proveedor.byCurrency, doc.currency, line.subtotal);

      const categoria = porCategoria.get(line.item.category) ?? {
        category: line.item.category,
        byCurrency: new Map(),
        qtyByUnit: new Map(),
      };
      addByCurrency(categoria.byCurrency, doc.currency, line.subtotal);
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
      addByCurrency(insumo.byCurrency, doc.currency, line.subtotal);
      porInsumo.set(line.item.slug, insumo);

      addByCurrency(totales, doc.currency, line.subtotal);

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

  const porRubro = new Map<ExpenseCategory, { category: ExpenseCategory; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porProveedor = new Map<string, { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porAlicuota = new Map<string, { rate: Prisma.Decimal; neto: Prisma.Decimal; iva: Prisma.Decimal }>();
  const totales = new Map<Currency, Prisma.Decimal>();
  const detalle: GastosReport["detalle"] = [];

  for (const doc of documents) {
    const { entity, circuit } = doc.account;
    const total = toDecimal(montoDelGasto(doc));

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
      addByCurrency(rubro.byCurrency, doc.currency, total);
      porRubro.set(rubroDelDoc, rubro);
    }

    const proveedor = porProveedor.get(entity.slug) ?? {
      entityName: entity.name,
      entitySlug: entity.slug,
      count: 0,
      byCurrency: new Map(),
    };
    proveedor.count++;
    addByCurrency(proveedor.byCurrency, doc.currency, total);
    porProveedor.set(entity.slug, proveedor);

    for (const tax of doc.taxes) {
      if (tax.kind !== "IVA" || !tax.rate) continue;
      const clave = tax.rate.toString();
      const fila = porAlicuota.get(clave) ?? { rate: tax.rate, neto: ZERO, iva: ZERO };
      fila.neto = fila.neto.plus(toDecimal(tax.base));
      fila.iva = fila.iva.plus(toDecimal(tax.amount));
      porAlicuota.set(clave, fila);
    }

    addByCurrency(totales, doc.currency, total);

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
    delPeriodo: Prisma.Decimal;
    acumulado: Prisma.Decimal;
  }[];
  /** Lo que el número NO está contando, para que se pueda discutir. */
  avisos: { itemsSinCosto: number; facturasSinCompra: { count: number; total: Prisma.Decimal } };
};

const MESES_DEL_COMPARATIVO = 6;

/**
 * Cuánto se ganó: ventas menos lo que costó producirlas menos los gastos, todo neto de IVA y en
 * pesos. Es la misma cuenta que la tarjeta del dashboard —`getRentabilidad`— abierta por rubro y
 * repetida mes a mes, que es lo que no se podía ver en ningún lado.
 *
 * Las cuentas en dólares quedan afuera: valuarlas necesitaría una cotización por comprobante y el
 * número dejaría de ser comparable contra el mes anterior.
 */
export async function getResultadoReport(period: Period): Promise<ResultadoReport> {
  const [actual, gastos, retirados] = await Promise.all([
    getRentabilidad(period),
    prisma.document.findMany({
      where: { ...GASTOS_WHERE, currency: "ARS", date: { gte: period.from, lt: period.to } },
      select: { netAmount: true, expenseCategory: true, treasuryCategory: true },
    }),
    getRetirosDelPeriodo(period),
  ]);

  // Sólo las cuentas donde efectivamente se retiró algo este mes: el acumulado se muestra al lado,
  // pero una fila en cero no dice nada.
  const retiros = retirados.filter((r) => !r.delPeriodo.isZero());

  const porRubro = new Map<ExpenseCategory | null, Prisma.Decimal>();
  for (const doc of gastos) {
    const rubro = rubroDelGasto(doc);
    porRubro.set(rubro, (porRubro.get(rubro) ?? ZERO).plus(toDecimal(doc.netAmount)));
  }

  // El mes del período es el del último día incluido: con "este mes" elegido, el `to` exclusivo cae
  // en el primero del siguiente y el comparativo arrancaría corrido.
  const ultimo = periodLastDay(period);
  const meses: ResultadoMes[] = [];
  for (let i = MESES_DEL_COMPARATIVO - 1; i >= 0; i--) {
    const mes = monthPeriod(new Date(ultimo.getFullYear(), ultimo.getMonth() - i, 1));
    const r = await getRentabilidad(mes);
    meses.push({
      label: mes.from.toLocaleDateString("es-AR", { month: "long", year: "numeric" }),
      from: mes.from,
      ventas: r.ingresos,
      costoInsumos: r.costoInsumos,
      gastos: r.gastos,
      resultado: r.rentabilidad,
    });
  }

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
    avisos: { itemsSinCosto: actual.itemsSinCosto, facturasSinCompra: actual.facturasSinCompra },
  };
}

// ---------------------------------------------------------------------------
// 9. Stock — de dónde salió cada movimiento entre dos recuentos
// ---------------------------------------------------------------------------

/** Un movimiento cuyo motivo dice que salió de contar el depósito, no de una operación. */
const ES_DE_RECUENTO = ["recuento", "stock inicial", "conteo"];

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
      // Lo que entró: lo producido, lo devuelto y el armado neto (armar suma pallets, desarmar
      // resta). Así la fila cierra sola contra el final.
      ingresos: suma(["PRODUCCION", "DEVOLUCION", "ARMADO", "DESARMADO"]),
      consumo: suma(["ENTREGA", "CONSUMO_ARMADO_CAJA"]).negated(),
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
      ingresos: suma(["PRODUCCION", "DEVOLUCION", "ARMADO", "DESARMADO"]),
      consumo: suma(["ENTREGA"]).negated(),
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
