"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";
import { CONTRIBUYENTE_KEYS } from "@/lib/libro-iva";

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

  revalidatePath("/libro-iva");
}
