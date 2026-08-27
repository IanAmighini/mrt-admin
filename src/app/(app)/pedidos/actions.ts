"use server";

import { revalidatePath } from "next/cache";
import type { PedidoStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";

const PEDIDO_STATUSES: PedidoStatus[] = ["EN_COLA", "COMPLETADO", "ENTREGADO"];

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new Error("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

function parseLines(formData: FormData) {
  const productIds = formData.getAll("lineProductId").map(String);
  const pallets = formData.getAll("linePallets").map(String);

  const lines = productIds
    .map((productId, i) => ({
      productId,
      pallets: toDecimal(pallets[i]),
    }))
    .filter((l) => l.productId && l.pallets.greaterThan(0));

  if (lines.length === 0) {
    throw new Error("Cargá al menos una línea con producto y cantidad de pallets.");
  }
  return lines;
}

export async function createPedido(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new Error("Elegí un cliente.");
  const date = parseFormDate(formData.get("date"));
  const orderNumber = String(formData.get("orderNumber") || "").trim();
  if (!orderNumber) throw new Error("Falta el número de pedido.");
  const comments = String(formData.get("comments") || "").trim() || null;
  const lines = parseLines(formData);

  await prisma.pedido.create({
    data: {
      date,
      entityId,
      orderNumber,
      comments,
      createdById: user.id,
      lines: {
        createMany: {
          data: lines.map((l) => ({ productId: l.productId, pallets: l.pallets })),
        },
      },
    },
  });

  revalidatePath("/pedidos");
}

async function getPedidoOrThrow(pedidoId: string) {
  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });
  if (!pedido) throw new Error("El pedido ya no existe.");
  return pedido;
}

export async function deletePedido(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);
  const pedidoId = String(formData.get("pedidoId") || "");
  await getPedidoOrThrow(pedidoId);

  await prisma.pedido.delete({ where: { id: pedidoId } });
  revalidatePath("/pedidos");
}

/**
 * Editar un pedido = borrar el pedido existente (las líneas se van en cascada) y volver a
 * correr createPedido con los datos nuevos — evita duplicar la lógica de armar las líneas.
 */
export async function updatePedido(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);
  const pedidoId = String(formData.get("pedidoId") || "");
  await getPedidoOrThrow(pedidoId);

  await prisma.pedido.delete({ where: { id: pedidoId } });
  await createPedido(formData);
}

export async function updatePedidoStatus(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);
  const pedidoId = String(formData.get("pedidoId") || "");
  const status = String(formData.get("status") || "") as PedidoStatus;
  if (!PEDIDO_STATUSES.includes(status)) throw new Error("Estado inválido.");

  const pedido = await getPedidoOrThrow(pedidoId);

  await prisma.pedido.update({
    where: { id: pedidoId },
    data: {
      status,
      deliveryDate:
        status === "ENTREGADO" ? (pedido.deliveryDate ?? new Date()) : pedido.deliveryDate,
    },
  });

  revalidatePath("/pedidos");
}
