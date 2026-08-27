import { prisma } from "./prisma";

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
    include: { lines: { include: { product: true } } },
    orderBy: { date: "asc" },
  });
}
