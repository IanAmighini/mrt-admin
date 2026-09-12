"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";
import { SETTING_RECIPIENTS, sendWeeklyReport } from "@/lib/weekly-report";
import { CONTRIBUYENTE_KEYS } from "@/lib/libro-iva";

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

  await setSetting(SETTING_RECIPIENTS, direcciones.join(", "));

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Configuración",
    summary: `Destinatarios del reporte semanal: ${direcciones.join(", ") || "ninguno"}`,
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

/** Los datos que encabezan el libro de IVA. Se guardan en Setting, como el resto de la config. */
export async function updateContribuyente(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const nombre = String(formData.get("contribuyenteNombre") || "").trim();
  const cuit = String(formData.get("contribuyenteCuit") || "").trim();
  if (!nombre) throw new UserError("Falta el nombre del contribuyente.");
  if (!cuit) throw new UserError("Falta el CUIT.");

  await Promise.all([
    setSetting(CONTRIBUYENTE_KEYS.nombre, nombre),
    setSetting(CONTRIBUYENTE_KEYS.cuit, cuit),
  ]);

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Configuración",
    entityId: "contribuyente",
    summary: `${nombre} — ${cuit}`,
  });

  revalidatePath("/reportes");
}
