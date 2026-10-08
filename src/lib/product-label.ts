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

/**
 * Cantidad de producto terminado en pallets y cajas, que es como se cuenta en el depósito.
 *
 * El stock se guarda en pallets con decimales —media docena de cajas sueltas es una fracción— pero
 * "17,952 pallets" no se parece a nada que se pueda ir a contar. Con las cajas por pallet del
 * producto se vuelve a "17 pallets + 80 cajas", que es lo que está anotado en la planilla.
 */
export function formatPallets(
  cantidad: Prisma.Decimal | number | string,
  boxesPerPallet: number | null
): string {
  const total = Number(cantidad);
  const signo = total < 0 ? "-" : "";
  const abs = Math.abs(total);
  const enteros = Math.floor(abs);
  // Sin cajas por pallet no hay a qué convertir la fracción, así que se muestra como viene.
  if (!boxesPerPallet) return `${formatQuantity(total)} pallets`;

  const cajas = Math.round((abs - enteros) * boxesPerPallet);
  // Redondear la fracción puede completar un pallet: 0,999 × 84 = 84 cajas, que son 1 pallet.
  const pallets = cajas === boxesPerPallet ? enteros + 1 : enteros;
  const sueltas = cajas === boxesPerPallet ? 0 : cajas;

  const partes: string[] = [];
  if (pallets > 0) partes.push(`${formatQuantity(pallets)} ${pallets === 1 ? "pallet" : "pallets"}`);
  if (sueltas > 0) partes.push(`${formatQuantity(sueltas)} ${sueltas === 1 ? "caja" : "cajas"}`);
  if (partes.length === 0) return "0 pallets";
  return signo + partes.join(" + ");
}

/**
 * Lo que lleva un remito, en palabras: "26 pallets + 3 cajas". Suma los pallets y las cajas de sus
 * líneas tal como se cargaron, sin pasar por el equivalente en pallets: "28,624 pallets" no le dice
 * nada a nadie, y además mezcla cajas de formatos distintos en una fracción.
 *
 * Las líneas de antes de las cajas sueltas sólo tienen `quantity`; esas se pasan a pallets y cajas
 * con las cajas por pallet de su producto.
 */
export function formatLineasDeRemito(
  lines: {
    quantity: Prisma.Decimal | number;
    pallets: number | null;
    cajas: number | null;
    botellas?: number | null;
    product: { boxesPerPallet: number | null };
  }[]
): string {
  let pallets = 0;
  let cajas = 0;
  let botellas = 0;
  for (const l of lines) {
    if (l.pallets !== null && l.cajas !== null) {
      pallets += l.pallets;
      cajas += l.cajas;
      botellas += l.botellas ?? 0;
      continue;
    }
    const q = Number(l.quantity);
    const enteros = Math.floor(q);
    const bpp = l.product.boxesPerPallet;
    pallets += enteros;
    if (bpp) cajas += Math.round((q - enteros) * bpp);
  }
  const partes: string[] = [];
  if (pallets > 0) partes.push(`${formatQuantity(pallets)} ${pallets === 1 ? "pallet" : "pallets"}`);
  if (cajas > 0) partes.push(`${formatQuantity(cajas)} ${cajas === 1 ? "caja" : "cajas"}`);
  if (botellas > 0) partes.push(`${formatQuantity(botellas)} ${botellas === 1 ? "botella" : "botellas"}`);
  return partes.length > 0 ? partes.join(" + ") : "—";
}
