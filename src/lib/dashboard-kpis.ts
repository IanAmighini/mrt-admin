import "server-only";
import { Prisma, type Currency, type EntityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { getDocumentEffect } from "@/lib/ledger";
import { getAllItemStocks } from "@/lib/stock";
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
async function getEfectoDocumentos(period: Period, typeFilter: EntityType[]) {
  const documents = await prisma.document.findMany({
    where: {
      date: { gte: period.from, lt: period.to },
      account: { entity: { type: { in: typeFilter } } },
    },
    include: {
      remitoLinks: true,
      allocations: true,
      lines: { include: { product: true } },
      purchaseLines: { include: { item: true } },
    },
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
 * Rentabilidad estimada del período: ingresos (ARS) menos costo de insumos consumidos. No incluye
 * otros costos fijos (mano de obra, alquiler, etc.).
 */
export async function getRentabilidad(period: Period = monthPeriod()) {
  const [ingresos, costo] = await Promise.all([getIngresos(period), getCostoInsumos(period)]);

  const ingresosArs = ingresos.get("ARS") ?? ZERO;
  return { rentabilidad: ingresosArs.minus(costo.total), itemsSinCosto: costo.itemsSinCosto };
}

/**
 * Producto terminado entregado en el período, valorizado: remitos con producto+cantidad cargados,
 * agrupados por producto, sumando cantidad y el monto ya cargado en el remito (no se recalcula con
 * el historial de precios para no tener dos fuentes de verdad sobre lo efectivamente cobrado).
 */
export async function getProductoEntregadoValorizado(period: Period = monthPeriod()) {
  const documents = await prisma.document.findMany({
    where: {
      type: "REMITO",
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
