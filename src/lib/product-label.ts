import type { Prisma } from "@prisma/client";
import { formatQuantity } from "./money";

/** Atajo que ya usa el equipo para "Alto Oleico" — mismo criterio que en el sistema anterior. */
const OIL_TYPE_SHORT: Record<string, string> = {
  "Alto Oleico": "A.O.",
};

export type ProductLabelInput = {
  name: string;
  oilType: string;
  bottleCapacityMl: Prisma.Decimal | number | string | null;
};

/**
 * Varios productos comparten marca y hasta el mismo envase (ml) pero son aceites distintos —
 * ej. dos "Cassan" de 5L, uno Girasol y otro Alto Oleico, con precio y contenido distintos. En
 * cualquier lugar donde se elige o se lista un producto hay que poder distinguirlos.
 */
export function formatProductLabel(product: ProductLabelInput): string {
  const oilLabel = OIL_TYPE_SHORT[product.oilType] ?? product.oilType;
  const ml = product.bottleCapacityMl ? ` — ${formatQuantity(product.bottleCapacityMl)}ml` : "";
  return `${product.name} ${oilLabel}${ml}`;
}
