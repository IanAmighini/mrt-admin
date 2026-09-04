"use server";

import { revalidatePath } from "next/cache";
import type { SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { generateUniqueSlug } from "@/lib/slug";

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
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

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
    const slug = await generateUniqueSlug(
      name,
      (candidate) => tx.item.findUnique({ where: { slug: candidate } }).then(Boolean),
      "insumo"
    );
    const item = await tx.item.create({
      data: {
        name,
        slug,
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

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Insumo",
      entityId: item.id,
      summary: name,
    });
  });

  revalidatePath("/stock");
}

/**
 * Costo unitario y stock mínimo de un insumo. Van juntos porque son los dos parámetros de la
 * ficha; el costo es obligatorio, pero el **mínimo se puede vaciar**: dejarlo en blanco es la
 * forma de decir "no me avises más por este insumo", y sin eso no habría manera de sacarlo del
 * control de faltantes.
 */
export async function updateItemAjustes(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const itemId = String(formData.get("itemId") || "");
  const unitCostRaw = String(formData.get("unitCost") || "").trim();
  const minStockRaw = String(formData.get("minStock") || "").trim();
  if (!itemId) throw new Error("Falta el insumo.");
  if (!unitCostRaw) throw new Error("Falta el costo unitario.");
  if (minStockRaw && toDecimal(minStockRaw).isNegative()) {
    throw new Error("El stock mínimo no puede ser negativo.");
  }

  const item = await prisma.item.update({
    where: { id: itemId },
    data: { unitCost: unitCostRaw, minStock: minStockRaw || null },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Insumo",
    entityId: itemId,
    summary: `${item.name} — costo unitario: ${unitCostRaw} · stock mínimo: ${minStockRaw || "sin mínimo"}`,
  });

  revalidatePath(`/stock/${item.slug}`);
  revalidatePath("/stock");
  // El reporte de insumos bajo mínimo lee este campo.
  revalidatePath("/reportes");
}
