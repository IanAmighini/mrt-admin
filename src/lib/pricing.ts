import "server-only";
import type { Circuit } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Precio vigente de un producto para una entidad+circuito a una fecha dada (por defecto hoy). */
export async function getCurrentPrice(
  productId: string,
  entityId: string,
  circuit: Circuit,
  asOf: Date = new Date()
) {
  return prisma.price.findFirst({
    where: { productId, entityId, circuit, validFrom: { lte: asOf } },
    orderBy: { validFrom: "desc" },
  });
}

/**
 * Precio vigente hoy de cada producto para una entidad+circuito — para armar la sugerencia
 * en el formulario de remito (uno por producto, el de `validFrom` más reciente que ya empezó).
 */
export async function getCurrentPricesForAccount(entityId: string, circuit: Circuit) {
  const prices = await prisma.price.findMany({
    where: { entityId, circuit, validFrom: { lte: new Date() } },
    orderBy: { validFrom: "desc" },
  });

  const current = new Map<string, (typeof prices)[number]>();
  for (const price of prices) {
    if (!current.has(price.productId)) {
      current.set(price.productId, price);
    }
  }
  return current;
}

/** Historial completo de precios de una entidad+circuito, para mostrar en la ficha del cliente. */
export async function getPriceHistory(entityId: string, circuit: Circuit) {
  return prisma.price.findMany({
    where: { entityId, circuit },
    include: { product: true, createdBy: true },
    orderBy: [{ productId: "asc" }, { validFrom: "desc" }],
  });
}
