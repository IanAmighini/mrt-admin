"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { diffDeCampos, logAudit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { CONTRIBUYENTE_KEYS } from "@/lib/libro-iva";
import { DIRECCION_KEY } from "@/lib/orden-pago";

/** Los datos que encabezan el libro de IVA. Se guardan en Setting, como el resto de la config. */
export async function updateContribuyente(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const nombre = String(formData.get("contribuyenteNombre") || "").trim();
  const cuit = String(formData.get("contribuyenteCuit") || "").trim();
  if (!nombre) throw new UserError("Falta el nombre del contribuyente.");
  if (!cuit) throw new UserError("Falta el CUIT.");

  const direccion = String(formData.get("contribuyenteDireccion") || "").trim();

  // Lo que había antes, para que el detalle de Actividad muestre de qué a qué cambió.
  const [nombreAntes, cuitAntes, direccionAntes] = await Promise.all([
    getSetting(CONTRIBUYENTE_KEYS.nombre, ""),
    getSetting(CONTRIBUYENTE_KEYS.cuit, ""),
    getSetting(DIRECCION_KEY, ""),
  ]);

  await Promise.all([
    setSetting(CONTRIBUYENTE_KEYS.nombre, nombre),
    setSetting(CONTRIBUYENTE_KEYS.cuit, cuit),
    setSetting(DIRECCION_KEY, direccion),
  ]);

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Configuración",
    entityId: "contribuyente",
    summary: `${nombre} — ${cuit}`,
    cambios: diffDeCampos(
      { nombre: nombreAntes, cuit: cuitAntes, direccion: direccionAntes },
      { nombre, cuit, direccion },
      { nombre: "Nombre", cuit: "CUIT", direccion: "Direcci\u00f3n" }
    ),
  });

  revalidatePath("/libro-iva");
  revalidatePath("/ordenes-pago");
}
