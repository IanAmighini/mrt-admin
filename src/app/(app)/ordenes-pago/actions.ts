"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { UserError } from "@/lib/user-error";
import { logAudit } from "@/lib/audit";
import { formatMoney, sumDecimals } from "@/lib/money";
import { formatNumeroOP, proximoNumero } from "@/lib/orden-pago";

/**
 * Agrupa pagos ya cargados en una orden de pago. No mueve un peso: los pagos ya existen, ya
 * imputaron contra las facturas y ya tocaron la tesorería. Esto sólo los junta bajo un número y una
 * fecha para poder imprimir el papel que firma el proveedor.
 */
export async function crearOrdenPago(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  const paymentIds = formData.getAll("paymentId").map(String).filter(Boolean);
  if (paymentIds.length === 0) throw new UserError("Elegí al menos un pago.");

  const fechaRaw = String(formData.get("date") || "").trim();
  if (!fechaRaw) throw new UserError("Falta la fecha.");
  const date = new Date(`${fechaRaw}T00:00:00`);
  const notes = String(formData.get("notes") || "").trim() || null;

  const pagos = await prisma.payment.findMany({
    where: { id: { in: paymentIds } },
    include: { account: { include: { entity: true } } },
  });
  if (pagos.length !== paymentIds.length) throw new UserError("Alguno de los pagos ya no existe.");

  // Todo en la misma cuenta: una orden es de un proveedor y sólo de la parte facturada.
  const fuera = pagos.filter(
    (p) => p.account.entityId !== entityId || p.account.circuit !== "BLANCO"
  );
  if (fuera.length > 0) {
    throw new UserError("Los pagos tienen que ser todos de la cuenta Blanco de este proveedor.");
  }

  const yaEnOtra = pagos.filter((p) => p.ordenPagoId);
  if (yaEnOtra.length > 0) {
    throw new UserError("Alguno de esos pagos ya está en otra orden de pago.");
  }

  const numero = await prisma.$transaction(async (tx) => {
    const numero = await proximoNumero(tx);
    const orden = await tx.ordenPago.create({
      data: { numero, date, entityId, notes, createdById: user.id },
    });
    await tx.payment.updateMany({
      where: { id: { in: paymentIds } },
      data: { ordenPagoId: orden.id },
    });

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Orden de pago",
      entityId,
      summary: `N° ${formatNumeroOP(numero)} — ${pagos[0].account.entity.name} — ${formatMoney(sumDecimals(pagos.map((p) => p.amount)))}`,
    });

    return numero;
  });

  revalidatePath(`/cuentas-corrientes/${pagos[0].account.entity.slug}`);
  revalidatePath("/ordenes-pago");
  redirect(`/ordenes-pago/${numero}`);
}

/** Deshacer una orden: los pagos vuelven a quedar sin orden y se pueden agrupar de nuevo. */
export async function anularOrdenPago(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const numero = Number(formData.get("numero"));
  const orden = await prisma.ordenPago.findUnique({
    where: { numero },
    include: { entity: true },
  });
  if (!orden) throw new UserError("Esa orden de pago no existe.");

  await prisma.$transaction(async (tx) => {
    // SetNull desengancha los pagos solo; se borra la orden y los pagos quedan intactos.
    await tx.ordenPago.delete({ where: { id: orden.id } });
    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Orden de pago",
      entityId: orden.entityId,
      summary: `N° ${formatNumeroOP(orden.numero)} — ${orden.entity.name}`,
    });
  });

  revalidatePath(`/cuentas-corrientes/${orden.entity.slug}`);
  revalidatePath("/ordenes-pago");
  redirect("/ordenes-pago");
}
