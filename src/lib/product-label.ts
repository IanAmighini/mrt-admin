import type { Prisma } from "@prisma/client";
import { formatQuantity } from "./money";

/** Atajo que ya usa el equipo para "Alto Oleico" — mismo criterio que en el sistema anterior. */
const OIL_TYPE_SHORT: Record<string, string> = {
  "Alto Oleico": "A.O.",
};

export type ProductBrandLabelInput = {
  name: string;
  oilType: string;
};

export type ProductLabelInput = ProductBrandLabelInput & {
  bottleCapacityMl: Prisma.Decimal | number | string | null;
};

/** Marca + tipo de aceite, sin el envase — ej. "Cassan A.O.". */
export function formatProductBrandLabel(product: ProductBrandLabelInput): string {
  const oilLabel = OIL_TYPE_SHORT[product.oilType] ?? product.oilType;
  return `${product.name} ${oilLabel}`;
}

/**
 * Varios productos comparten marca y hasta el mismo envase (ml) pero son aceites distintos —
 * ej. dos "Cassan" de 5L, uno Girasol y otro Alto Oleico, con precio y contenido distintos. En
 * cualquier lugar donde se elige o se lista un producto hay que poder distinguirlos.
 */
export function formatProductLabel(product: ProductLabelInput): string {
  const ml = product.bottleCapacityMl ? ` — ${formatQuantity(product.bottleCapacityMl)}ml` : "";
  return `${formatProductBrandLabel(product)}${ml}`;
}
