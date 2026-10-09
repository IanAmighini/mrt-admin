import "server-only";
import { prisma } from "./prisma";
import { getDocumentPending } from "./ledger";
import { formatFecha } from "./period";
import { formatMoney } from "./money";

export type VentaACobrar = { id: string; circuit: "BLANCO" | "NEGRO"; label: string; pendiente: number };

/**
 * Las ventas de insumos a un proveedor, para que su cobro diga cuál paga. Son créditos de su cuenta
 * (le bajan lo que le debemos), así que lo que falta cobrar es lo que queda de ese crédito.
 *
 * Trae también las ya cobradas si `incluir` las nombra: al editar un cobro, su venta tiene que
 * seguir en la lista aunque ese mismo cobro la haya saldado.
 */
export async function getVentasACobrar(entityId: string, incluir: (string | null)[] = []): Promise<VentaACobrar[]> {
  const docs = await prisma.document.findMany({
    where: {
      account: { entityId },
      type: "NOTA_CREDITO",
      itemMovements: { some: { type: "VENTA" } },
    },
    include: {
      account: { select: { circuit: true } },
      remitoLinks: { include: { factura: { select: { id: true, number: true, date: true } } } },
      allocations: true,
      creditosAplicados: true,
      creditosRecibidos: true,
    },
    orderBy: { date: "asc" },
  });
  return docs
    .map((d) => ({ d, pendiente: getDocumentPending(d).negated().toNumber() }))
    .filter(({ d, pendiente }) => pendiente > 0.005 || incluir.includes(d.id))
    .map(({ d, pendiente }) => ({
      id: d.id,
      circuit: d.account.circuit as "BLANCO" | "NEGRO",
      pendiente,
      label: `#${d.number} del ${formatFecha(d.date)} — ${pendiente > 0.005 ? `falta cobrar ${formatMoney(pendiente, d.currency)}` : "cobrada"}`,
    }));
}
