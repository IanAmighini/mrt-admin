"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";

export async function createItem(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const name = String(formData.get("name") || "").trim();
  const unit = String(formData.get("unit") || "").trim();
  const isResellable = formData.get("isResellable") === "on";
  const minStockRaw = String(formData.get("minStock") || "").trim();
  const unitCostRaw = String(formData.get("unitCost") || "").trim();

  if (!name) throw new Error("El nombre es obligatorio.");
  if (!unit) throw new Error("La unidad de medida es obligatoria.");

  await prisma.item.create({
    data: {
      name,
      unit,
      isResellable,
      minStock: minStockRaw || null,
      unitCost: unitCostRaw || null,
    },
  });

  revalidatePath("/stock");
}

export async function updateItemCost(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const itemId = String(formData.get("itemId") || "");
  const unitCostRaw = String(formData.get("unitCost") || "").trim();
  if (!itemId) throw new Error("Falta el insumo.");
  if (!unitCostRaw) throw new Error("Falta el costo unitario.");

  await prisma.item.update({
    where: { id: itemId },
    data: { unitCost: unitCostRaw },
  });

  revalidatePath(`/stock/${itemId}`);
  revalidatePath("/stock");
}
