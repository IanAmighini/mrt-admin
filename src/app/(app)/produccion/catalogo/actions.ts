"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";

function parseRequiredInt(value: FormDataEntryValue | null, label: string): number {
  const n = parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(n)) throw new Error(`${label} debe ser un número.`);
  return n;
}

function revalidateCatalogo() {
  revalidatePath("/produccion/catalogo");
  revalidatePath("/produccion");
}

export async function createMarca(formData: FormData) {
  await requireRole(["ADMIN", "SECRETARIA"]);

  const name = String(formData.get("name") || "").trim();
  const oilType = String(formData.get("oilType") || "").trim();
  if (!name) throw new Error("Falta el nombre de la marca.");
  if (!oilType) throw new Error("Falta el tipo de aceite.");

  const existing = await prisma.marca.findUnique({ where: { name_oilType: { name, oilType } } });
  if (existing) throw new Error(`Ya existe la marca "${name} ${oilType}".`);

  await prisma.marca.create({ data: { name, oilType } });
  revalidateCatalogo();
}

export async function updateMarca(formData: FormData) {
  await requireRole(["ADMIN", "SECRETARIA"]);

  const marcaId = String(formData.get("marcaId") || "");
  const name = String(formData.get("name") || "").trim();
  const oilType = String(formData.get("oilType") || "").trim();
  if (!marcaId) throw new Error("Falta la marca.");
  if (!name) throw new Error("Falta el nombre de la marca.");
  if (!oilType) throw new Error("Falta el tipo de aceite.");

  const existing = await prisma.marca.findUnique({ where: { name_oilType: { name, oilType } } });
  if (existing && existing.id !== marcaId) {
    throw new Error(`Ya existe la marca "${name} ${oilType}".`);
  }

  await prisma.marca.update({ where: { id: marcaId }, data: { name, oilType } });
  revalidateCatalogo();
}

export async function deleteMarca(formData: FormData) {
  await requireRole(["ADMIN", "SECRETARIA"]);

  const marcaId = String(formData.get("marcaId") || "");
  if (!marcaId) throw new Error("Falta la marca.");

  await prisma.marca.delete({ where: { id: marcaId } });
  revalidateCatalogo();
}

export async function createFormato(formData: FormData) {
  await requireRole(["ADMIN", "SECRETARIA"]);

  const presentation = String(formData.get("presentation") || "").trim();
  const boxesPerPallet = parseRequiredInt(formData.get("boxesPerPallet"), "Cajas por pallet");
  const unitsPerBox = parseRequiredInt(formData.get("unitsPerBox"), "Botellas por caja");
  const bottleCapacityMl = String(formData.get("bottleCapacityMl") || "").trim();
  if (!presentation) throw new Error("Falta la presentación.");
  if (!bottleCapacityMl) throw new Error("Falta la capacidad de botella.");

  const existing = await prisma.formato.findUnique({ where: { presentation } });
  if (existing) throw new Error(`Ya existe el formato "${presentation}".`);

  await prisma.formato.create({
    data: { presentation, boxesPerPallet, unitsPerBox, bottleCapacityMl },
  });
  revalidateCatalogo();
}

export async function updateFormato(formData: FormData) {
  await requireRole(["ADMIN", "SECRETARIA"]);

  const formatoId = String(formData.get("formatoId") || "");
  const presentation = String(formData.get("presentation") || "").trim();
  const boxesPerPallet = parseRequiredInt(formData.get("boxesPerPallet"), "Cajas por pallet");
  const unitsPerBox = parseRequiredInt(formData.get("unitsPerBox"), "Botellas por caja");
  const bottleCapacityMl = String(formData.get("bottleCapacityMl") || "").trim();
  if (!formatoId) throw new Error("Falta el formato.");
  if (!presentation) throw new Error("Falta la presentación.");
  if (!bottleCapacityMl) throw new Error("Falta la capacidad de botella.");

  const existing = await prisma.formato.findUnique({ where: { presentation } });
  if (existing && existing.id !== formatoId) {
    throw new Error(`Ya existe el formato "${presentation}".`);
  }

  await prisma.formato.update({
    where: { id: formatoId },
    data: { presentation, boxesPerPallet, unitsPerBox, bottleCapacityMl },
  });
  revalidateCatalogo();
}

export async function deleteFormato(formData: FormData) {
  await requireRole(["ADMIN", "SECRETARIA"]);

  const formatoId = String(formData.get("formatoId") || "");
  if (!formatoId) throw new Error("Falta el formato.");

  await prisma.formato.delete({ where: { id: formatoId } });
  revalidateCatalogo();
}
