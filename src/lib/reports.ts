import "server-only";
import { Prisma, type Currency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { getDocumentEffect } from "@/lib/ledger";
import { getAllItemStocks } from "@/lib/stock";

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfNextMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

/**
 * Litros de aceite consumidos en producción — proxy de "litros envasados": se toman los
 * insumos medidos en litros (unit === "L") consumidos por CONSUMO_PRODUCCION, ya que es lo
 * único que se mide en litros en este negocio y el consumo de aceite = lo que se envasó.
 */
export async function getLitrosEnvasados(referenceDate: Date = new Date()) {
  const movements = await prisma.itemMovement.findMany({
    where: { type: "CONSUMO_PRODUCCION", item: { unit: "L" } },
  });

  const monthStart = startOfMonth(referenceDate);
  const monthEnd = startOfNextMonth(referenceDate);

  const total = sumDecimals(movements.map((m) => m.quantity)).negated().plus(ZERO);
  const esteMes = sumDecimals(
    movements.filter((m) => m.date >= monthStart && m.date < monthEnd).map((m) => m.quantity)
  )
    .negated()
    .plus(ZERO);

  return { esteMes, total };
}

/**
 * Ingresos del mes actual (efecto de los documentos de clientes con fecha en el mes, por
 * moneda) — solo entidades CLIENTE/AMBOS, porque un documento de un PROVEEDOR es un compromiso
 * de pago nuestro, no un ingreso. No es "rentabilidad" (falta el costo de insumos, que no
 * tiene precio unitario cargado todavía), es la parte que sí se puede calcular con los datos
 * actuales.
 */
export async function getIngresosDelMes(referenceDate: Date = new Date()) {
  const monthStart = startOfMonth(referenceDate);
  const monthEnd = startOfNextMonth(referenceDate);

  const documents = await prisma.document.findMany({
    where: {
      date: { gte: monthStart, lt: monthEnd },
      account: { entity: { type: { in: ["CLIENTE", "AMBOS"] } } },
    },
    include: { remitoLinks: true, allocations: true, lines: { include: { product: true } }, purchaseLines: { include: { item: true } } },
  });

  const byCurrency = new Map<Currency, Prisma.Decimal>();
  for (const doc of documents) {
    const effect = getDocumentEffect(doc);
    const current = byCurrency.get(doc.currency) ?? sumDecimals([]);
    byCurrency.set(doc.currency, current.plus(effect));
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

/**
 * Costo de los insumos consumidos en producción este mes (CONSUMO_PRODUCCION × costo unitario),
 * solo para insumos con costo cargado. `itemsSinCosto` avisa cuántos insumos se consumieron sin
 * costo unitario cargado, para poder marcar el número como parcial en la UI.
 */
export async function getCostoInsumosDelMes(
  referenceDate: Date = new Date()
): Promise<{ total: Prisma.Decimal; itemsSinCosto: number }> {
  const monthStart = startOfMonth(referenceDate);
  const monthEnd = startOfNextMonth(referenceDate);

  const movements = await prisma.itemMovement.findMany({
    where: { type: "CONSUMO_PRODUCCION", date: { gte: monthStart, lt: monthEnd } },
    include: { item: true },
  });

  let total = ZERO;
  const itemsSinCosto = new Set<string>();

  for (const m of movements) {
    if (m.item.unitCost) {
      total = total.plus(toDecimal(m.quantity).abs().times(m.item.unitCost));
    } else {
      itemsSinCosto.add(m.itemId);
    }
  }

  return { total, itemsSinCosto: itemsSinCosto.size };
}

/**
 * Rentabilidad estimada del mes: ingresos (ARS) menos costo de insumos consumidos. No incluye
 * otros costos fijos (mano de obra, alquiler, etc. — quedan abiertos en el spec, sección 13).
 */
export async function getRentabilidadDelMes(referenceDate: Date = new Date()) {
  const [ingresos, costo] = await Promise.all([
    getIngresosDelMes(referenceDate),
    getCostoInsumosDelMes(referenceDate),
  ]);

  const ingresosArs = ingresos.get("ARS") ?? ZERO;
  return { rentabilidad: ingresosArs.minus(costo.total), itemsSinCosto: costo.itemsSinCosto };
}

/**
 * Producto terminado entregado este mes, valorizado: remitos con producto+cantidad cargados
 * (módulo de precios), agrupados por producto, sumando cantidad y el monto ya cargado en el
 * remito (no se recalcula con el historial de precios para no tener dos fuentes de verdad sobre
 * lo efectivamente cobrado).
 */
export async function getProductoEntregadoValorizado(referenceDate: Date = new Date()) {
  const monthStart = startOfMonth(referenceDate);
  const monthEnd = startOfNextMonth(referenceDate);

  const documents = await prisma.document.findMany({
    where: {
      type: "REMITO",
      date: { gte: monthStart, lt: monthEnd },
      account: { entity: { type: { in: ["CLIENTE", "AMBOS"] } } },
    },
    include: { product: true, lines: { include: { product: true } } },
  });

  const byProduct = new Map<
    string,
    { product: Prisma.ProductGetPayload<object>; quantity: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }
  >();

  function addLine(productId: string, product: Prisma.ProductGetPayload<object>, quantity: Prisma.Decimal, currency: Currency, amount: Prisma.Decimal) {
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
    if (doc.lines.length > 0) {
      for (const line of doc.lines) {
        addLine(line.productId, line.product, line.quantity, doc.currency, line.subtotal);
      }
    } else if (doc.product && doc.quantity) {
      addLine(doc.productId!, doc.product, doc.quantity, doc.currency, doc.totalAmount);
    }
  }

  return Array.from(byProduct.values());
}
