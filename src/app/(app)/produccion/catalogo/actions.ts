"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";

function parseRequiredInt(value: FormDataEntryValue | null, label: string): number {
  const n = parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(n)) throw new UserError(`${label} debe ser un número.`);
  return n;
}

function revalidateCatalogo() {
  revalidatePath("/produccion/catalogo");
  revalidatePath("/produccion");
}

export async function createMarca(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const name = String(formData.get("name") || "").trim();
  const oilType = String(formData.get("oilType") || "").trim();
  // Un checkbox que no se tilda no viaja en el FormData, así que ausente = false.
  const usaEtiqueta = formData.get("usaEtiqueta") !== null;
  if (!name) throw new UserError("Falta el nombre de la marca.");
  if (!oilType) throw new UserError("Falta el tipo de aceite.");

  const existing = await prisma.marca.findUnique({ where: { name_oilType: { name, oilType } } });
  if (existing) throw new UserError(`Ya existe la marca "${name} ${oilType}".`);

  const marca = await prisma.marca.create({ data: { name, oilType, usaEtiqueta } });
  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Marca",
    entityId: marca.id,
    summary: `${name} ${oilType}${usaEtiqueta ? "" : " (sin etiqueta)"}`,
  });
  revalidateCatalogo();
}

export async function updateMarca(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const marcaId = String(formData.get("marcaId") || "");
  const name = String(formData.get("name") || "").trim();
  const oilType = String(formData.get("oilType") || "").trim();
  const usaEtiqueta = formData.get("usaEtiqueta") !== null;
  if (!marcaId) throw new UserError("Falta la marca.");
  if (!name) throw new UserError("Falta el nombre de la marca.");
  if (!oilType) throw new UserError("Falta el tipo de aceite.");

  const existing = await prisma.marca.findUnique({ where: { name_oilType: { name, oilType } } });
  if (existing && existing.id !== marcaId) {
    throw new UserError(`Ya existe la marca "${name} ${oilType}".`);
  }

  await prisma.marca.update({ where: { id: marcaId }, data: { name, oilType, usaEtiqueta } });
  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Marca",
    entityId: marcaId,
    summary: `${name} ${oilType}${usaEtiqueta ? "" : " (sin etiqueta)"}`,
  });
  revalidateCatalogo();
}

export async function deleteMarca(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const marcaId = String(formData.get("marcaId") || "");
  if (!marcaId) throw new UserError("Falta la marca.");

  const marca = await prisma.marca.findUnique({ where: { id: marcaId } });
  await prisma.marca.delete({ where: { id: marcaId } });
  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Marca",
    entityId: marcaId,
    summary: marca ? `${marca.name} ${marca.oilType}` : "Marca",
  });
  revalidateCatalogo();
}

export async function createFormato(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const presentation = String(formData.get("presentation") || "").trim();
  const boxesPerPallet = parseRequiredInt(formData.get("boxesPerPallet"), "Cajas por pallet");
  const unitsPerBox = parseRequiredInt(formData.get("unitsPerBox"), "Botellas por caja");
  const bottleCapacityMl = String(formData.get("bottleCapacityMl") || "").trim();
  if (!presentation) throw new UserError("Falta la presentación.");
  if (!bottleCapacityMl) throw new UserError("Falta la capacidad de botella.");

  const existing = await prisma.formato.findUnique({ where: { presentation } });
  if (existing) throw new UserError(`Ya existe el formato "${presentation}".`);

  const formato = await prisma.formato.create({
    data: { presentation, boxesPerPallet, unitsPerBox, bottleCapacityMl },
  });
  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Formato",
    entityId: formato.id,
    summary: presentation,
  });
  revalidateCatalogo();
}

export async function updateFormato(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const formatoId = String(formData.get("formatoId") || "");
  const presentation = String(formData.get("presentation") || "").trim();
  const boxesPerPallet = parseRequiredInt(formData.get("boxesPerPallet"), "Cajas por pallet");
  const unitsPerBox = parseRequiredInt(formData.get("unitsPerBox"), "Botellas por caja");
  const bottleCapacityMl = String(formData.get("bottleCapacityMl") || "").trim();
  if (!formatoId) throw new UserError("Falta el formato.");
  if (!presentation) throw new UserError("Falta la presentación.");
  if (!bottleCapacityMl) throw new UserError("Falta la capacidad de botella.");

  const existing = await prisma.formato.findUnique({ where: { presentation } });
  if (existing && existing.id !== formatoId) {
    throw new UserError(`Ya existe el formato "${presentation}".`);
  }

  await prisma.formato.update({
    where: { id: formatoId },
    data: { presentation, boxesPerPallet, unitsPerBox, bottleCapacityMl },
  });
  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Formato",
    entityId: formatoId,
    summary: presentation,
  });
  revalidateCatalogo();
}

export async function deleteFormato(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const formatoId = String(formData.get("formatoId") || "");
  if (!formatoId) throw new UserError("Falta el formato.");

  const formato = await prisma.formato.findUnique({ where: { id: formatoId } });
  await prisma.formato.delete({ where: { id: formatoId } });
  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Formato",
    entityId: formatoId,
    summary: formato ? formato.presentation : "Formato",
  });
  revalidateCatalogo();
}
