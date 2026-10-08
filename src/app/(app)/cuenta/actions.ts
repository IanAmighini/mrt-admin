"use server";

import { UserError } from "@/lib/user-error";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { hashPassword, verifyPassword } from "@/lib/password";
import { logAudit } from "@/lib/audit";

/**
 * Cada uno cambia la suya, desde la llave del encabezado. Pide la actual: la sesión queda abierta
 * en la compu de la oficina, y sin eso cualquiera que pase por adelante podría cambiarla.
 */
export async function cambiarMiContrasena(formData: FormData) {
  const user = await requireUser();

  const actual = String(formData.get("actual") || "");
  const nueva = String(formData.get("nueva") || "");
  const repetida = String(formData.get("repetida") || "");

  if (!actual || !nueva || !repetida) throw new UserError("Completá los tres campos.");
  if (nueva.length < 8) throw new UserError("La contraseña nueva tiene que tener al menos 8 caracteres.");
  if (nueva !== repetida) throw new UserError("La contraseña nueva y la repetida no coinciden.");

  const guardado = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!guardado || !(await verifyPassword(actual, guardado.passwordHash))) {
    throw new UserError("La contraseña actual no es correcta.");
  }
  if (await verifyPassword(nueva, guardado.passwordHash)) {
    throw new UserError("La contraseña nueva es igual a la actual.");
  }

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(nueva) } });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Usuario",
    entityId: user.id,
    summary: `${user.name} — cambió su contraseña`,
  });
}
