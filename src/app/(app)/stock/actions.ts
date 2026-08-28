"use server";

import { revalidatePath } from "next/cache";
import type { SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";

const CATEGORIES: SupplierCategory[] = [
  "ACEITE",
  "ENVASES",
  "CAJAS",
  "TAPAS",
  "ETIQUETAS",
  "CINTA",
  "PALLET_NORMALIZADO",
  "OTRO",
];

export async function createItem(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const name = String(formData.get("name") || "").trim();
  const unit = String(formData.get("unit") || "").trim();
  const category = String(formData.get("category") || "") as SupplierCategory;
  const isResellable = formData.get("isResellable") === "on";
  const minStockRaw = String(formData.get("minStock") || "").trim();
  const unitCostRaw = String(formData.get("unitCost") || "").trim();
  const stockInicialRaw = String(formData.get("stockInicial") || "").trim();

  if (!name) throw new Error("El nombre es obligatorio.");
  if (!unit) throw new Error("La unidad de medida es obligatoria.");
  if (!CATEGORIES.includes(category)) throw new Error("Elegí una categoría válida.");

  await prisma.$transaction(async (tx) => {
    const item = await tx.item.create({
      data: {
        name,
        unit,
        category,
        isResellable,
        minStock: minStockRaw || null,
        unitCost: unitCostRaw || null,
      },
    });

    if (stockInicialRaw && Number(stockInicialRaw) !== 0) {
      await tx.itemMovement.create({
        data: {
          itemId: item.id,
          date: new Date(),
          quantity: stockInicialRaw,
          type: "INGRESO",
          reason: "Stock inicial",
          createdById: user.id,
        },
      });
    }
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
