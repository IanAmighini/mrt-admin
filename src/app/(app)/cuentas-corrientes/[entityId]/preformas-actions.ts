"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { parseNumeroEscrito, formatQuantity } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { UserError } from "@/lib/user-error";

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

/**
 * Registra preformas entregadas al proveedor que las fía, para bajar lo que se le debe.
 *
 * No mueve stock a propósito: se le compran a otro proveedor y se le entregan directo, sin pasar
 * por el depósito. La compra en sí es una compra común, en su propia cuenta corriente.
 */
export async function createEntregaPreforma(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  const preformaId = String(formData.get("preformaId") || "");
  if (!entityId) throw new UserError("Falta el proveedor.");
  if (!preformaId) throw new UserError("Elegí el tipo de preforma.");

  const date = parseFormDate(formData.get("date"));
  const quantity = parseNumeroEscrito(String(formData.get("quantity") || ""), "cantidad");
  if (!quantity.greaterThan(0)) {
    throw new UserError("La cantidad entregada tiene que ser mayor a cero.");
  }

  const comprobante = String(formData.get("comprobante") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;

  const [entity, preforma] = await Promise.all([
    prisma.entity.findUnique({ where: { id: entityId }, select: { name: true, slug: true } }),
    prisma.preforma.findUnique({ where: { id: preformaId }, select: { name: true } }),
  ]);
  if (!entity) throw new UserError("El proveedor ya no existe.");
  if (!preforma) throw new UserError("El tipo de preforma ya no existe.");

  const entrega = await prisma.entregaPreforma.create({
    data: { entityId, preformaId, date, quantity, comprobante, notes, createdById: user.id },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Entrega de preformas",
    entityId: entrega.id,
    summary: `${entity.name} — ${formatQuantity(quantity)} de ${preforma.name}`,
  });

  revalidatePath(`/cuentas-corrientes/${entity.slug}`);
}

export async function deleteEntregaPreforma(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entregaId = String(formData.get("entregaId") || "");
  const entrega = await prisma.entregaPreforma.findUnique({
    where: { id: entregaId },
    include: { entity: { select: { name: true, slug: true } }, preforma: { select: { name: true } } },
  });
  if (!entrega) throw new UserError("La entrega ya no existe.");

  await prisma.entregaPreforma.delete({ where: { id: entregaId } });

  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Entrega de preformas",
    entityId: entregaId,
    summary: `${entrega.entity.name} — ${formatQuantity(entrega.quantity)} de ${entrega.preforma.name}`,
  });

  revalidatePath(`/cuentas-corrientes/${entrega.entity.slug}`);
}
