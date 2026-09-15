"use server";

import { revalidatePath } from "next/cache";
import type { ChequeEstado } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { UserError } from "@/lib/user-error";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { marcarCheque } from "@/lib/cheques";
import { CHEQUE_ESTADO_LABELS } from "@/lib/labels";

const ESTADOS_MANUALES: ChequeEstado[] = ["DEPOSITADO", "RECHAZADO", "EN_CARTERA"];

/** Depositar un cheque, o marcarlo rechazado. Entregarlo no se hace acá: eso es cargar el pago. */
export async function actualizarEstadoCheque(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const chequeId = String(formData.get("chequeId") || "");
  const estado = String(formData.get("estado") || "") as ChequeEstado;
  if (!ESTADOS_MANUALES.includes(estado)) throw new UserError("Estado inválido.");

  await marcarCheque(chequeId, estado);

  const cheque = await prisma.cheque.findUnique({ where: { id: chequeId } });
  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Cheque",
    entityId: chequeId,
    summary: `#${cheque?.numero ?? chequeId} — ${CHEQUE_ESTADO_LABELS[estado]}`,
  });

  revalidatePath("/tesoreria/cheques");
}
