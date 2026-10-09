import "server-only";
import { Prisma, type Currency, type EntityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { getDocumentEffect } from "@/lib/ledger";
import { getAllItemStocks } from "@/lib/stock";
import { NUMERO_SALDO_INICIAL } from "@/lib/saldo-inicial";
import { GASTOS_WHERE } from "@/lib/caja";
import { monthPeriod, type Period } from "@/lib/period";

/**
 * Litros de aceite consumidos en producción — proxy de "litros envasados": se toman los
 * insumos medidos en litros (unit === "L") consumidos por CONSUMO_PRODUCCION, ya que es lo
 * único que se mide en litros en este negocio y el consumo de aceite = lo que se envasó.
 */
export async function getLitrosEnvasados(period: Period = monthPeriod()) {
  const movements = await prisma.itemMovement.findMany({
    where: { type: "CONSUMO_PRODUCCION", item: { unit: "L" } },
  });

  const total = sumDecimals(movements.map((m) => m.quantity)).negated().plus(ZERO);
  const enPeriodo = sumDecimals(
    movements.filter((m) => m.date >= period.from && m.date < period.to).map((m) => m.quantity)
  )
    .negated()
    .plus(ZERO);

  return { enPeriodo, total };
}

/** Efecto (por moneda) de los documentos del período de las entidades de los tipos dados. */
/**
 * El saldo inicial es lo que se debía antes de que existiera el sistema, no actividad del mes.
 * Contarlo como ingreso o como compra hace que el primer mes muestre números enormes: la cuenta de
 * La Campechana arranca en 329 millones y eso no es una venta de septiembre.
 */
const SIN_SALDO_INICIAL = { number: { not: NUMERO_SALDO_INICIAL } };

const DOCUMENT_INCLUDE_EFECTO = {
  remitoLinks: true,
  allocations: true,
  lines: { include: { product: true } },
  purchaseLines: { include: { item: true } },
} satisfies Prisma.DocumentInclude;

async function getEfectoDocumentos(period: Period, typeFilter: EntityType[]) {
  const documents = await prisma.document.findMany({
    where: {
      date: { gte: period.from, lt: period.to },
      account: { entity: { type: { in: typeFilter } } },
      ...SIN_SALDO_INICIAL,
    },
    include: DOCUMENT_INCLUDE_EFECTO,
  });

  const byCurrency = new Map<Currency, Prisma.Decimal>();
  for (const doc of documents) {
    const current = byCurrency.get(doc.currency) ?? ZERO;
    byCurrency.set(doc.currency, current.plus(getDocumentEffect(doc)));
  }

  return byCurrency;
}

/**
 * Ingresos del período (efecto de los documentos de clientes con fecha en el rango, por moneda) —
 * solo entidades CLIENTE/AMBOS, porque un documento de un PROVEEDOR es un compromiso de pago
 * nuestro, no un ingreso. No es "rentabilidad" (falta el costo de insumos), es la parte que sí se
 * puede calcular con los datos actuales.
 */
export async function getIngresos(period: Period = monthPeriod()) {
  return getEfectoDocumentos(period, ["CLIENTE", "AMBOS"]);
}

/**
 * Compras del período: mismo criterio que getIngresos pero del lado PROVEEDOR/AMBOS — cuánta deuda
 * nueva generaron los comprobantes cargados en el rango.
 */
export async function getCompras(period: Period = monthPeriod()) {
  return getEfectoDocumentos(period, ["PROVEEDOR", "AMBOS"]);
}

/** Pagos del período, por moneda — filtrado por tipo de entidad (clientes o proveedores). */
export async function getPagos(typeFilter: EntityType[], period: Period = monthPeriod()) {
  const payments = await prisma.payment.findMany({
    where: {
      date: { gte: period.from, lt: period.to },
      account: { entity: { type: { in: typeFilter } } },
    },
  });

  const byCurrency = new Map<Currency, Prisma.Decimal>();
  for (const p of payments) {
    const current = byCurrency.get(p.currency) ?? ZERO;
    byCurrency.set(p.currency, current.plus(p.amount));
  }

  return byCurrency;
}

export type ValuacionRow = {
  item: Prisma.ItemGetPayload<object>;
  stock: Prisma.Decimal;
  valuacion: Prisma.Decimal | null;
};

/** Valuación de insumos en stock: cantidad × costo unitario, por insumo y total. */
export async function getValuacionInsumos(): Promise<{ rows: ValuacionRow[]; total: Prisma.Decimal }> {
  const [items, stocks] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    getAllItemStocks(),
  ]);

  const rows: ValuacionRow[] = items.map((item) => {
    const stock = stocks.get(item.id) ?? ZERO;
    const valuacion = item.unitCost ? stock.times(item.unitCost) : null;
    return { item, stock, valuacion };
  });

  const total = sumDecimals(rows.map((r) => r.valuacion ?? ZERO));

  return { rows, total };
}

export type CostoInsumoRow = {
  item: Prisma.ItemGetPayload<object>;
  cantidad: Prisma.Decimal;
  costo: Prisma.Decimal | null;
};

/**
 * Costo de los insumos consumidos en producción en el período (CONSUMO_PRODUCCION × costo
 * unitario), solo para insumos con costo cargado. `itemsSinCosto` avisa cuántos insumos se
 * consumieron sin costo unitario cargado, para poder marcar el número como parcial en la UI.
 */
export async function getCostoInsumos(period: Period = monthPeriod()): Promise<{
  total: Prisma.Decimal;
  itemsSinCosto: number;
  porItem: CostoInsumoRow[];
}> {
  const movements = await prisma.itemMovement.findMany({
    where: { type: "CONSUMO_PRODUCCION", date: { gte: period.from, lt: period.to } },
    include: { item: true },
  });

  const porItem = new Map<string, CostoInsumoRow>();
  let total = ZERO;
  const itemsSinCosto = new Set<string>();

  for (const m of movements) {
    const cantidad = toDecimal(m.quantity).abs();
    const costo = m.item.unitCost ? cantidad.times(m.item.unitCost) : null;

    if (costo) total = total.plus(costo);
    else itemsSinCosto.add(m.itemId);

    const current = porItem.get(m.itemId);
    if (current) {
      current.cantidad = current.cantidad.plus(cantidad);
      current.costo = costo ? (current.costo ?? ZERO).plus(costo) : current.costo;
    } else {
      porItem.set(m.itemId, { item: m.item, cantidad, costo });
    }
  }

  return {
    total,
    itemsSinCosto: itemsSinCosto.size,
    porItem: Array.from(porItem.values()).sort((a, b) => a.item.name.localeCompare(b.item.name)),
  };
}

/**
 * Lo facturado en el período sin el IVA. El IVA no es ingreso: se cobra y se deposita, así que
 * compararlo contra costos netos infla el margen en una quinta parte de las ventas en Blanco.
 *
 * Se saca proporcionalmente del efecto y no sumando `netAmount` a secas, para no perder la lógica
 * de `getDocumentEffect`: un remito ya facturado aporta cero, y uno facturado a medias aporta sólo
 * lo que le queda pendiente.
 */
async function getIngresosNetos(period: Period): Promise<Prisma.Decimal> {
  const documents = await prisma.document.findMany({
    where: {
      date: { gte: period.from, lt: period.to },
      currency: "ARS",
      account: { entity: { type: { in: ["CLIENTE", "AMBOS"] } } },
      ...SIN_SALDO_INICIAL,
      // Las ventas de insumos van aparte (getVentasDeInsumos), con su costo: acá se contarían dos veces.
      itemMovements: { none: { type: "VENTA" } },
    },
    include: DOCUMENT_INCLUDE_EFECTO,
  });

  return documents.reduce((acc, doc) => {
    const efecto = getDocumentEffect(doc);
    const total = toDecimal(doc.totalAmount);
    // Sin IVA discriminado —todo Negro— el efecto ya es neto.
    const neto = total.isZero() ? efecto : efecto.times(toDecimal(doc.netAmount)).dividedBy(total);
    return acc.plus(neto);
  }, ZERO);
}

/**
 * Lo que se vendió de insumos en el período —tapas sobrantes, envases, pallets descartables— y lo
 * que costó. Cuenta como venta sea a quien sea: a un cliente se le cobra y a un proveedor se le
 * descuenta de lo que le debemos, pero en los dos casos es una venta.
 *
 * El costo de cada venta es la cantidad por el costo del insumo: el costo unitario cargado en su
 * ficha; si no tiene, el precio de la última compra; y si tampoco hay compra, el precio al que se
 * vendió. Ese último caso da margen cero a propósito: un insumo se vende al costo o más, así que
 * nunca agranda la ganancia.
 */
export async function getVentasDeInsumos(period: Period) {
  const movimientos = await prisma.itemMovement.findMany({
    where: {
      type: "VENTA",
      date: { gte: period.from, lt: period.to },
      document: { currency: "ARS" },
    },
    include: { item: true, document: { select: { netAmount: true } } },
  });
  const ultimasCompras = await prisma.purchaseLine.findMany({
    where: { itemId: { in: [...new Set(movimientos.map((m) => m.itemId))] }, document: { currency: "ARS" } },
    select: { itemId: true, unitPrice: true, document: { select: { date: true } } },
    orderBy: { document: { date: "desc" } },
  });

  let ventas = ZERO;
  let costo = ZERO;
  let sinCostoConocido = 0;
  for (const m of movimientos) {
    const cantidad = toDecimal(m.quantity).abs();
    const venta = toDecimal(m.document?.netAmount ?? 0);
    ventas = ventas.plus(venta);
    const compra = ultimasCompras.find((c) => c.itemId === m.itemId && c.document.date <= m.date);
    const unitario = m.item.unitCost ?? compra?.unitPrice ?? null;
    if (unitario) costo = costo.plus(cantidad.times(unitario));
    else {
      costo = costo.plus(venta);
      sinCostoConocido++;
    }
  }
  return { ventas, costo, cantidad: movimientos.length, sinCostoConocido };
}

/**
 * Los gastos del período: flete, alquiler, luz, honorarios. De los dos circuitos, porque un gasto
 * en negro cuesta igual, y por el neto, porque el IVA de un gasto en blanco es crédito fiscal y no
 * costo.
 *
 * Incluye lo que sale de la caja sin factura —sueldos, limpieza, el remís—, que es plata que sale
 * igual: mientras no estuvo, el margen del mes se veía mejor de lo que era.
 */
async function getGastosNetos(period: Period): Promise<Prisma.Decimal> {
  const documents = await prisma.document.findMany({
    where: { ...GASTOS_WHERE, currency: "ARS", date: { gte: period.from, lt: period.to } },
    select: { netAmount: true },
  });
  return sumDecimals(documents.map((d) => d.netAmount));
}

/**
 * Los insumos que no llevan stock —pegamento, stretch, jabón, aditivo— se consumen sin pasar por el
 * depósito, así que no generan un CONSUMO_PRODUCCION que valorizar. Su costo es el de la compra.
 */
async function getCostoInsumosSinStock(period: Period): Promise<Prisma.Decimal> {
  const lines = await prisma.purchaseLine.findMany({
    where: {
      item: { llevaStock: false },
      document: { currency: "ARS", date: { gte: period.from, lt: period.to } },
    },
    select: { subtotal: true },
  });
  return sumDecimals(lines.map((l) => l.subtotal));
}

/**
 * Facturas de proveedor que no cubren ninguna compra. Su costo no entra al margen —el de los
 * insumos sale del consumo en producción, y sin compra cargada no hay stock que consumir— así que
 * en vez de adivinar si son un costo o un duplicado, se avisan.
 */
async function getFacturasDeProveedorSinCompra(period: Period) {
  const documents = await prisma.document.findMany({
    where: {
      type: "FACTURA",
      currency: "ARS",
      date: { gte: period.from, lt: period.to },
      account: { entity: { type: { in: ["PROVEEDOR", "AMBOS"] } } },
      facturaLinks: { none: {} },
    },
    select: { netAmount: true },
  });
  return { count: documents.length, total: sumDecimals(documents.map((d) => d.netAmount)) };
}

/**
 * Margen del período: lo facturado menos lo que costó producirlo menos los gastos. Todo neto de
 * IVA y en pesos — las cuentas en dólares quedan afuera porque valuarlas necesitaría una cotización
 * por comprobante y el número dejaría de ser comparable contra el mes anterior.
 */
export async function getRentabilidad(period: Period = monthPeriod()) {
  const [ventasDeProducto, costo, sinStock, gastos, sueltas, ventasDeInsumos] = await Promise.all([
    getIngresosNetos(period),
    getCostoInsumos(period),
    getCostoInsumosSinStock(period),
    getGastosNetos(period),
    getFacturasDeProveedorSinCompra(period),
    getVentasDeInsumos(period),
  ]);

  // Lo vendido de insumos suma a las ventas, y lo que costó, al costo de lo vendido.
  const ingresos = ventasDeProducto.plus(ventasDeInsumos.ventas);
  const costoInsumos = costo.total.plus(sinStock).plus(ventasDeInsumos.costo);
  return {
    ingresos,
    costoInsumos,
    gastos,
    ventasDeInsumos,
    rentabilidad: ingresos.minus(costoInsumos).minus(gastos),
    itemsSinCosto: costo.itemsSinCosto,
    facturasSinCompra: sueltas,
  };
}

/**
 * Producto terminado entregado en el período, valorizado: remitos con producto+cantidad cargados,
 * agrupados por producto, sumando cantidad y el monto ya cargado en el remito (no se recalcula con
 * el historial de precios para no tener dos fuentes de verdad sobre lo efectivamente cobrado).
 */
export async function getProductoEntregadoValorizado(period: Period = monthPeriod()) {
  // Los remitos menos las devoluciones (notas de crédito con producto): lo devuelto se entregó pero
  // no se vendió.
  const documents = await prisma.document.findMany({
    where: {
      OR: [{ type: "REMITO" }, { type: "NOTA_CREDITO", lines: { some: {} } }],
      date: { gte: period.from, lt: period.to },
      account: { entity: { type: { in: ["CLIENTE", "AMBOS"] } } },
    },
    include: { product: true, lines: { include: { product: true } } },
  });

  const byProduct = new Map<
    string,
    { product: Prisma.ProductGetPayload<object>; quantity: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }
  >();

  function addLine(
    productId: string,
    product: Prisma.ProductGetPayload<object>,
    quantity: Prisma.Decimal,
    currency: Currency,
    amount: Prisma.Decimal
  ) {
    const current = byProduct.get(productId) ?? {
      product,
      quantity: ZERO,
      byCurrency: new Map<Currency, Prisma.Decimal>(),
    };
    current.quantity = current.quantity.plus(quantity);
    const currentAmount = current.byCurrency.get(currency) ?? ZERO;
    current.byCurrency.set(currency, currentAmount.plus(amount));
    byProduct.set(productId, current);
  }

  for (const doc of documents) {
    const signo = doc.type === "NOTA_CREDITO" ? -1 : 1;
    if (doc.lines.length > 0) {
      for (const line of doc.lines) {
        addLine(line.productId, line.product, line.quantity.times(signo), doc.currency, line.subtotal.times(signo));
      }
    } else if (doc.product && doc.quantity) {
      addLine(doc.productId!, doc.product, doc.quantity, doc.currency, doc.totalAmount);
    }
  }

  return Array.from(byProduct.values());
}
