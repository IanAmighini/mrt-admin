import { prisma } from "./prisma";

export function getPedidosPendientesByEntity(entityId: string) {
  return prisma.pedido.findMany({
    where: { entityId, status: { not: "ENTREGADO" } },
    include: { lines: { include: { product: true } } },
    orderBy: { date: "asc" },
  });
}

export type PedidoPendiente = Awaited<ReturnType<typeof getPedidosPendientesByEntity>>[number];
