"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";
import { getSetting } from "@/lib/settings";

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  const str = String(value || "").trim();
  if (!str) return null;
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
}

export async function updateProduct(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

  const productId = String(formData.get("productId") || "");
  const name = String(formData.get("name") || "").trim();
  const oilType = String(formData.get("oilType") || "").trim();
  const presentation = String(formData.get("presentation") || "").trim();
  const boxesPerPallet = parseOptionalInt(formData.get("boxesPerPallet"));
  const unitsPerBox = parseOptionalInt(formData.get("unitsPerBox"));
  const bottleCapacityMlRaw = String(formData.get("bottleCapacityMl") || "").trim();

  if (!productId) throw new Error("Falta el producto.");
  if (!name) throw new Error("El nombre es obligatorio.");
  if (!oilType) throw new Error("El tipo de aceite es obligatorio.");
  if (!presentation) throw new Error("La presentación es obligatoria.");

  await prisma.product.update({
    where: { id: productId },
    data: {
      name,
      oilType,
      presentation,
      boxesPerPallet,
      unitsPerBox,
      bottleCapacityMl: bottleCapacityMlRaw || null,
    },
  });

  revalidatePath(`/produccion/${productId}`);
  revalidatePath("/produccion");
}

export async function generateRecipeFromPresentation(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

  const productId = String(formData.get("productId") || "");
  if (!productId) throw new Error("Falta el producto.");

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error("El producto ya no existe.");
  if (!product.boxesPerPallet || !product.unitsPerBox) {
    throw new Error(
      "Este producto no tiene cargado cajas por pallet / botellas por caja — completalo en 'Editar producto'."
    );
  }

  const unitsPerPallet = product.boxesPerPallet * product.unitsPerBox;

  const woodPalletItemId = String(formData.get("woodPalletItemId") || "");
  const bottleItemId = String(formData.get("bottleItemId") || "");
  const capItemId = String(formData.get("capItemId") || "");
  const labelItemId = String(formData.get("labelItemId") || "");
  const boxItemId = String(formData.get("boxItemId") || "");
  const oilItemId = String(formData.get("oilItemId") || "");

  const lines: { itemId: string; quantityPerUnit: ReturnType<typeof toDecimal> }[] = [];

  if (woodPalletItemId) {
    lines.push({ itemId: woodPalletItemId, quantityPerUnit: toDecimal(1) });
  }
  for (const itemId of [bottleItemId, capItemId, labelItemId]) {
    if (itemId) {
      lines.push({ itemId, quantityPerUnit: toDecimal(unitsPerPallet) });
    }
  }
  if (boxItemId) {
    lines.push({ itemId: boxItemId, quantityPerUnit: toDecimal(product.boxesPerPallet) });
  }
  if (oilItemId) {
    if (!product.bottleCapacityMl) {
      throw new Error(
        "Este producto no tiene cargada la capacidad de la botella — completala en 'Editar producto'."
      );
    }
    const efficiencyPercent = toDecimal(await getSetting("oilFillEfficiencyPercent", "100"));
    const oilLiters = toDecimal(unitsPerPallet)
      .times(product.bottleCapacityMl)
      .times(efficiencyPercent)
      .dividedBy(100)
      .dividedBy(1000);
    lines.push({ itemId: oilItemId, quantityPerUnit: oilLiters });
  }

  if (lines.length === 0) {
    throw new Error("Elegí al menos un insumo para generar la receta.");
  }

  await prisma.$transaction(
    lines.map((line) =>
      prisma.recipeItem.upsert({
        where: { productId_itemId: { productId, itemId: line.itemId } },
        update: { quantityPerUnit: line.quantityPerUnit },
        create: { productId, itemId: line.itemId, quantityPerUnit: line.quantityPerUnit },
      })
    )
  );

  revalidatePath(`/produccion/${productId}`);
  revalidatePath("/produccion");
}

export async function upsertRecipeLine(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

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
  await requireRole(["ADMIN", "CARGA_DIARIA", "SECRETARIA"]);

  const recipeItemId = String(formData.get("recipeItemId") || "");
  const productId = String(formData.get("productId") || "");
  if (!recipeItemId) throw new Error("Falta el ítem de receta.");

  await prisma.recipeItem.delete({ where: { id: recipeItemId } });

  revalidatePath(`/produccion/${productId}`);
  revalidatePath("/produccion");
}
