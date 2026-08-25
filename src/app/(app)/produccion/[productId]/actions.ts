"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";

export async function upsertRecipeLine(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const productId = String(formData.get("productId") || "");
  const itemId = String(formData.get("itemId") || "");
  const quantityPerUnitRaw = String(formData.get("quantityPerUnit") || "").trim();

  if (!productId || !itemId) throw new Error("Faltan datos.");
  if (!quantityPerUnitRaw) throw new Error("Falta la cantidad por unidad.");

  const quantityPerUnit = toDecimal(quantityPerUnitRaw);
  if (!quantityPerUnit.greaterThan(0)) {
    throw new Error("La cantidad por unidad debe ser mayor a cero.");
  }

  await prisma.recipeItem.upsert({
    where: { productId_itemId: { productId, itemId } },
    update: { quantityPerUnit },
    create: { productId, itemId, quantityPerUnit },
  });

  revalidatePath(`/produccion/${productId}`);
  revalidatePath("/produccion");
}

export async function deleteRecipeLine(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const recipeItemId = String(formData.get("recipeItemId") || "");
  const productId = String(formData.get("productId") || "");
  if (!recipeItemId) throw new Error("Falta el ítem de receta.");

  await prisma.recipeItem.delete({ where: { id: recipeItemId } });

  revalidatePath(`/produccion/${productId}`);
  revalidatePath("/produccion");
}
