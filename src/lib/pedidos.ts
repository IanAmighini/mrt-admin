import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { sumDecimals } from "./money";

export function getPedidosPendientesByEntity(entityId: string) {
  return prisma.pedido.findMany({
    where: { entityId, status: { not: "ENTREGADO" } },
    include: { lines: { include: { product: true } } },
    orderBy: { date: "asc" },
  });
}

export type PedidoPendiente = Awaited<ReturnType<typeof getPedidosPendientesByEntity>>[number];

/** Pedidos pendientes (no entregados) de todas las entidades a la vez — para un formulario donde
 * todavía no se eligió cliente (ej. Nueva entrega). */
export function getAllPedidosPendientes() {
  return prisma.pedido.findMany({
    where: { status: { not: "ENTREGADO" } },
    include: { entity: true, lines: { include: { product: true } } },
    orderBy: { date: "asc" },
  });
}

type Tx = Prisma.TransactionClient;

/**
 * Pasa a "Terminado" los pedidos "En cola" que ya tienen stock suficiente para todas sus líneas.
 * Se llama después de cada producción (que es lo único que puede hacer que un pedido pase a estar
 * disponible). Nunca hace el camino inverso: si el stock baja después, el pedido se queda
 * Terminado — no hay reversa automática, un admin puede cambiarlo a mano si hace falta.
 *
 * Los pedidos se procesan del más viejo al más nuevo y cada uno que se completa "reserva" su
 * stock para el resto del cálculo, así dos pedidos pidiendo lo mismo no se marcan ambos Terminado
 * si solo alcanza para uno.
 */
export async function syncPedidoStatuses(tx: Tx) {
  const pending = await tx.pedido.findMany({
    where: { status: "EN_COLA" },
    include: { lines: true },
    orderBy: { date: "asc" },
  });
  if (pending.length === 0) return;

  const productIds = Array.from(new Set(pending.flatMap((p) => p.lines.map((l) => l.productId))));
  const movements = await tx.productMovement.findMany({ where: { productId: { in: productIds } } });
  const remaining = new Map<string, Prisma.Decimal>();
  for (const productId of productIds) {
    remaining.set(
      productId,
      sumDecimals(movements.filter((m) => m.productId === productId).map((m) => m.quantity))
    );
  }

  const completedIds: string[] = [];
  for (const pedido of pending) {
    const allSatisfied = pedido.lines.every((line) => !remaining.get(line.productId)!.lessThan(line.pallets));
    if (!allSatisfied) continue;

    for (const line of pedido.lines) {
      remaining.set(line.productId, remaining.get(line.productId)!.minus(line.pallets));
    }
    completedIds.push(pedido.id);
  }

  if (completedIds.length > 0) {
    await tx.pedido.updateMany({ where: { id: { in: completedIds } }, data: { status: "COMPLETADO" } });
  }
}
