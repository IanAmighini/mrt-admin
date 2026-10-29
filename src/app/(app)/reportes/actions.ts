"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { SETTING_RECIPIENTS, sendWeeklyReport } from "@/lib/weekly-report";
import { sendMonthlyReport } from "@/lib/monthly-report";
import { periodFromSearchParams } from "@/lib/period";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Solo Admin: define a qué direcciones se manda información financiera de la empresa. */
export async function updateWeeklyReportRecipients(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const raw = String(formData.get("recipients") || "");
  const direcciones = Array.from(
    new Set(
      raw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  const invalidas = direcciones.filter((d) => !EMAIL_RE.test(d));
  if (invalidas.length > 0) {
    throw new UserError(`Direcciones inválidas: ${invalidas.join(", ")}`);
  }

  const antes = await getSetting(SETTING_RECIPIENTS, "");
  await setSetting(SETTING_RECIPIENTS, direcciones.join(", "));

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Configuración",
    summary: `Destinatarios del reporte semanal: ${direcciones.join(", ") || "ninguno"}`,
    cambios: [
      {
        campo: "Destinatarios del reporte semanal",
        antes: antes || null,
        despues: direcciones.join(", ") || null,
      },
    ],
  });

  revalidatePath("/reportes");
}

export type SendNowResult = { ok: boolean; mensaje: string };

/** Manda el reporte en el momento — es cómo se prueba la configuración sin esperar al lunes. */
export async function sendWeeklyReportNow(): Promise<SendNowResult> {
  const user = await requireRole(["ADMIN"]);

  const resultado = await sendWeeklyReport({ force: true });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Configuración",
    summary: resultado.enviado
      ? `Reporte semanal enviado a mano (${resultado.semana}) — ${resultado.destinatarios.length} destinatario(s)`
      : `Reporte semanal no enviado: ${resultado.motivo ?? "motivo desconocido"}`,
  });

  revalidatePath("/reportes");

  return resultado.enviado
    ? {
        ok: true,
        mensaje: `Enviado a ${resultado.destinatarios.length} destinatario(s): ${resultado.destinatarios.join(", ")}`,
      }
    : { ok: false, mensaje: `No se envió: ${resultado.motivo ?? "motivo desconocido"}` };
}

/**
 * Manda el cierre del mes que se está mirando en Reportes, en el momento: para probarlo sin esperar
 * al 1°, o para mandarlo de nuevo después de una corrección.
 */
export async function sendMonthlyReportNow(formData: FormData): Promise<SendNowResult> {
  const user = await requireRole(["ADMIN"]);
  const { period } = periodFromSearchParams({
    preset: String(formData.get("preset") || "") || undefined,
    from: String(formData.get("from") || "") || undefined,
    to: String(formData.get("to") || "") || undefined,
  });

  const resultado = await sendMonthlyReport({ period, force: true });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Configuración",
    summary: resultado.enviado
      ? `Cierre de ${resultado.mes} enviado a mano — ${resultado.destinatarios.length} destinatario(s)`
      : `Cierre de ${resultado.mes} no enviado: ${resultado.motivo ?? "motivo desconocido"}`,
  });

  return resultado.enviado
    ? { ok: true, mensaje: `Cierre de ${resultado.mes} enviado a: ${resultado.destinatarios.join(", ")}` }
    : { ok: false, mensaje: `No se envió: ${resultado.motivo ?? "motivo desconocido"}` };
}
