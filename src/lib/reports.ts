import "server-only";
import { Prisma, type Currency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals } from "@/lib/money";
import { getDocumentEffect } from "@/lib/ledger";

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

  const total = sumDecimals(movements.map((m) => m.quantity)).negated();
  const esteMes = sumDecimals(
    movements.filter((m) => m.date >= monthStart && m.date < monthEnd).map((m) => m.quantity)
  ).negated();

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
    include: { remitoLinks: true, allocations: true },
  });

  const byCurrency = new Map<Currency, Prisma.Decimal>();
  for (const doc of documents) {
    const effect = getDocumentEffect(doc);
    const current = byCurrency.get(doc.currency) ?? sumDecimals([]);
    byCurrency.set(doc.currency, current.plus(effect));
  }

  return byCurrency;
}
