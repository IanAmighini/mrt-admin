"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import type { SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";
import { getSetting } from "@/lib/settings";
import { logAudit } from "@/lib/audit";
import { litrosPorPallet } from "@/lib/recipe-template";

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  const str = String(value || "").trim();
  if (!str) return null;
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
}

export async function updateProduct(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const productId = String(formData.get("productId") || "");
  const name = String(formData.get("name") || "").trim();
  const oilType = String(formData.get("oilType") || "").trim();
  const presentation = String(formData.get("presentation") || "").trim();
  const boxesPerPallet = parseOptionalInt(formData.get("boxesPerPallet"));
  const unitsPerBox = parseOptionalInt(formData.get("unitsPerBox"));
  const bottleCapacityMlRaw = String(formData.get("bottleCapacityMl") || "").trim();

  if (!productId) throw new UserError("Falta el producto.");
  if (!name) throw new UserError("El nombre es obligatorio.");
  if (!oilType) throw new UserError("El tipo de aceite es obligatorio.");
  if (!presentation) throw new UserError("La presentación es obligatoria.");

  const product = await prisma.product.update({
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

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Producto",
    entityId: productId,
    summary: `${name} ${oilType} — ${presentation}`,
  });

  revalidatePath(`/produccion/${product.slug}`);
  revalidatePath("/produccion");
}

export async function generateRecipeFromPresentation(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const productId = String(formData.get("productId") || "");
  if (!productId) throw new UserError("Falta el producto.");

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new UserError("El producto ya no existe.");
  if (!product.boxesPerPallet || !product.unitsPerBox) {
    throw new UserError(
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

  // Cada rol del generador se corresponde con una categoría de insumo. Validarlo importa porque el
  // resto de la app decide por categoría: cuál es la tapa de la receta, qué se puede reemplazar al
  // producir, y qué líneas limpia el deleteMany de más abajo.
  const ROLES: { itemId: string; category: SupplierCategory; label: string }[] = [
    { itemId: woodPalletItemId, category: "PALLET_NORMALIZADO", label: "Pallet" },
    { itemId: bottleItemId, category: "ENVASES", label: "Envase" },
    { itemId: capItemId, category: "TAPAS", label: "Tapa" },
    { itemId: labelItemId, category: "ETIQUETAS", label: "Etiqueta" },
    { itemId: boxItemId, category: "CAJAS", label: "Caja" },
    { itemId: oilItemId, category: "ACEITE", label: "Aceite" },
  ];
  const elegidos = ROLES.filter((r) => r.itemId);
  const itemsElegidos = await prisma.item.findMany({
    where: { id: { in: elegidos.map((r) => r.itemId) } },
    select: { id: true, name: true, category: true },
  });
  for (const rol of elegidos) {
    const item = itemsElegidos.find((i) => i.id === rol.itemId);
    if (!item) throw new UserError(`El insumo elegido para ${rol.label} ya no existe.`);
    if (item.category !== rol.category) {
      throw new UserError(`"${item.name}" no es un insumo de ${rol.label.toLowerCase()}.`);
    }
  }

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
      throw new UserError(
        "Este producto no tiene cargada la capacidad de la botella — completala en 'Editar producto'."
      );
    }
    const efficiencyPercent = toDecimal(await getSetting("oilFillEfficiencyPercent", "100"));
    lines.push({
      itemId: oilItemId,
      quantityPerUnit: litrosPorPallet(unitsPerPallet, product.bottleCapacityMl, efficiencyPercent),
    });
  }

  if (lines.length === 0) {
    throw new UserError("Elegí al menos un insumo para generar la receta.");
  }

  await prisma.$transaction(async (tx) => {
    // Antes solo se hacía upsert, así que regenerar la receta con otra tapa dejaba las dos y
    // producir consumía ambas. Se limpia lo anterior, pero **solo de las categorías que se
    // completaron**: un rol vacío tiene que seguir significando "no toques", no "borrá". Excluir
    // los recién elegidos lo hace idempotente.
    await tx.recipeItem.deleteMany({
      where: {
        productId,
        item: { category: { in: elegidos.map((r) => r.category) } },
        itemId: { notIn: lines.map((l) => l.itemId) },
      },
    });

    for (const line of lines) {
      await tx.recipeItem.upsert({
        where: { productId_itemId: { productId, itemId: line.itemId } },
        update: { quantityPerUnit: line.quantityPerUnit },
        create: { productId, itemId: line.itemId, quantityPerUnit: line.quantityPerUnit },
      });
    }
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Receta",
    entityId: productId,
    summary: `Receta de ${product.name} ${product.oilType} generada automáticamente — ${lines.length} insumo(s)`,
  });

  revalidatePath(`/produccion/${product.slug}`);
  revalidatePath("/produccion");
}

export async function upsertRecipeLine(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const productId = String(formData.get("productId") || "");
  const itemId = String(formData.get("itemId") || "");
  const quantityPerUnitRaw = String(formData.get("quantityPerUnit") || "").trim();

  if (!productId || !itemId) throw new UserError("Faltan datos.");
  if (!quantityPerUnitRaw) throw new UserError("Falta la cantidad por unidad.");

  const quantityPerUnit = toDecimal(quantityPerUnitRaw);
  if (!quantityPerUnit.greaterThan(0)) {
    throw new UserError("La cantidad por unidad debe ser mayor a cero.");
  }

  const [item, product] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId } }),
    prisma.product.findUnique({ where: { id: productId }, select: { slug: true } }),
  ]);

  await prisma.recipeItem.upsert({
    where: { productId_itemId: { productId, itemId } },
    update: { quantityPerUnit },
    create: { productId, itemId, quantityPerUnit },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Receta",
    entityId: productId,
    summary: `${item?.name ?? "Insumo"} — ${quantityPerUnitRaw} por unidad`,
  });

  revalidatePath(`/produccion/${product?.slug ?? productId}`);
  revalidatePath("/produccion");
}

export async function deleteRecipeLine(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const recipeItemId = String(formData.get("recipeItemId") || "");
  const productId = String(formData.get("productId") || "");
  if (!recipeItemId) throw new UserError("Falta el ítem de receta.");

  const [recipeItem, product] = await Promise.all([
    prisma.recipeItem.findUnique({
      where: { id: recipeItemId },
      include: { item: true },
    }),
    prisma.product.findUnique({ where: { id: productId }, select: { slug: true } }),
  ]);

  await prisma.recipeItem.delete({ where: { id: recipeItemId } });

  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Receta",
    entityId: productId,
    summary: recipeItem ? recipeItem.item.name : "Ítem de receta",
  });

  revalidatePath(`/produccion/${product?.slug ?? productId}`);
  revalidatePath("/produccion");
}
