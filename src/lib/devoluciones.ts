import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const PREFIJO = "DEV-";

/**
 * El número de la próxima devolución: DEV-00001, DEV-00002… Uno solo para todos los clientes,
 * como un talonario. Si la devolución se parte en Cuenta 1 y Cuenta 2, las dos partes llevan el
 * mismo número, igual que un remito.
 */
export async function proximoNumeroDeDevolucion(db: Prisma.TransactionClient | typeof prisma = prisma) {
  const ultimo = await db.document.findFirst({
    where: { type: "NOTA_CREDITO", number: { startsWith: PREFIJO } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = ultimo ? Number(ultimo.number.slice(PREFIJO.length)) + 1 : 1;
  return `${PREFIJO}${String(n).padStart(5, "0")}`;
}
