"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import type { Prisma, PedidoStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { resolveOrCreateProduct } from "@/lib/products";
import { syncPedidoStatuses } from "@/lib/pedidos";
import { logAudit } from "@/lib/audit";

const PEDIDO_STATUSES: PedidoStatus[] = ["EN_COLA", "COMPLETADO", "ENTREGADO"];

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

function parseLines(formData: FormData) {
  const marcaIds = formData.getAll("lineMarcaId").map(String);
  const formatoIds = formData.getAll("lineFormatoId").map(String);
  const pallets = formData.getAll("linePallets").map(String);

  const lines = marcaIds
    .map((marcaId, i) => ({
      marcaId,
      formatoId: formatoIds[i] || "",
      pallets: toDecimal(pallets[i] || "0"),
    }))
    .filter((l) => l.marcaId && l.formatoId && l.pallets.greaterThan(0));

  if (lines.length === 0) {
    throw new UserError("Cargá al menos una línea con marca, formato y cantidad de pallets.");
  }
  return lines;
}

async function nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const pedidos = await tx.pedido.findMany({ select: { orderNumber: true } });
  const maxNum = pedidos.reduce((max, p) => {
    const n = parseInt(p.orderNumber, 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return String(maxNum + 1).padStart(4, "0");
}

export async function createPedido(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new UserError("Elegí un cliente.");
  const date = parseFormDate(formData.get("date"));
  const comments = String(formData.get("comments") || "").trim() || null;
  const lines = parseLines(formData);
  // Lo necesita la receta que se arma sola si alguna línea estrena producto.
  const oilFillEfficiencyPercent = toDecimal(await getSetting("oilFillEfficiencyPercent", "100"));

  await prisma.$transaction(async (tx) => {
    const orderNumber = await nextOrderNumber(tx);

    const pedido = await tx.pedido.create({
      data: { date, entityId, orderNumber, comments, createdById: user.id },
    });

    const lineData = [];
    for (const line of lines) {
      const product = await resolveOrCreateProduct(tx, line.marcaId, line.formatoId, oilFillEfficiencyPercent);
      lineData.push({ pedidoId: pedido.id, productId: product.id, pallets: line.pallets });
    }
    await tx.pedidoLine.createMany({ data: lineData });

    await syncPedidoStatuses(tx);

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Pedido",
      entityId: pedido.id,
      summary: `Pedido #${orderNumber}`,
    });
  }, { timeout: 20000 });

  revalidatePath("/pedidos");
}

async function getPedidoOrThrow(pedidoId: string) {
  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });
  if (!pedido) throw new UserError("El pedido ya no existe.");
  return pedido;
}

export async function deletePedido(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  const pedidoId = String(formData.get("pedidoId") || "");
  const existing = await getPedidoOrThrow(pedidoId);

  await prisma.pedido.delete({ where: { id: pedidoId } });
  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Pedido",
    entityId: pedidoId,
    summary: `Pedido #${existing.orderNumber}`,
  });
  revalidatePath("/pedidos");
}

export async function updatePedido(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  const pedidoId = String(formData.get("pedidoId") || "");
  const existing = await getPedidoOrThrow(pedidoId);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new UserError("Elegí un cliente.");
  const date = parseFormDate(formData.get("date"));
  const comments = String(formData.get("comments") || "").trim() || null;
  const lines = parseLines(formData);
  // Lo necesita la receta que se arma sola si alguna línea estrena producto.
  const oilFillEfficiencyPercent = toDecimal(await getSetting("oilFillEfficiencyPercent", "100"));

  await prisma.$transaction(async (tx) => {
    await tx.pedidoLine.deleteMany({ where: { pedidoId } });

    await tx.pedido.update({
      where: { id: pedidoId },
      data: { entityId, date, comments },
    });

    const lineData = [];
    for (const line of lines) {
      const product = await resolveOrCreateProduct(tx, line.marcaId, line.formatoId, oilFillEfficiencyPercent);
      lineData.push({ pedidoId, productId: product.id, pallets: line.pallets });
    }
    await tx.pedidoLine.createMany({ data: lineData });

    if (existing.status === "EN_COLA") {
      await syncPedidoStatuses(tx);
    }

    await logAudit(tx, {
      userId: user.id,
      action: "UPDATE",
      entityType: "Pedido",
      entityId: pedidoId,
      summary: `Pedido #${existing.orderNumber}`,
    });
  }, { timeout: 20000 });

  revalidatePath("/pedidos");
}

export async function updatePedidoStatus(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  const pedidoId = String(formData.get("pedidoId") || "");
  const status = String(formData.get("status") || "") as PedidoStatus;
  if (!PEDIDO_STATUSES.includes(status)) throw new UserError("Estado inválido.");

  const pedido = await getPedidoOrThrow(pedidoId);

  await prisma.pedido.update({
    where: { id: pedidoId },
    data: {
      status,
      deliveryDate:
        status === "ENTREGADO" ? (pedido.deliveryDate ?? new Date()) : pedido.deliveryDate,
    },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Pedido",
    entityId: pedidoId,
    summary: `Pedido #${pedido.orderNumber} — estado: ${status}`,
  });

  revalidatePath("/pedidos");
}
