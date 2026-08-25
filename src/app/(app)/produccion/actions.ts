"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new Error("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

export async function createProduct(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const name = String(formData.get("name") || "").trim();
  const oilType = String(formData.get("oilType") || "").trim();
  const presentation = String(formData.get("presentation") || "").trim();

  if (!name) throw new Error("El nombre es obligatorio.");
  if (!oilType) throw new Error("El tipo de aceite es obligatorio.");
  if (!presentation) throw new Error("La presentación es obligatoria.");

  await prisma.product.create({ data: { name, oilType, presentation } });

  revalidatePath("/produccion");
}

export async function createProductionRun(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const date = parseFormDate(formData.get("date"));
  const productIds = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity").map(String);

  const lines = productIds
    .map((productId, i) => ({ productId, quantity: toDecimal(quantities[i]) }))
    .filter((l) => l.productId && l.quantity.greaterThan(0));

  if (lines.length === 0) {
    throw new Error("Cargá al menos un producto con cantidad.");
  }

  const dateLabel = date.toLocaleDateString("es-AR");

  await prisma.$transaction(async (tx) => {
    const run = await tx.productionRun.create({
      data: { date, createdById: user.id },
    });

    for (const line of lines) {
      const product = await tx.product.findUnique({
        where: { id: line.productId },
        include: { recipe: true },
      });
      if (!product) throw new Error("Alguno de los productos seleccionados ya no existe.");

      await tx.productionLine.create({
        data: { productionRunId: run.id, productId: product.id, quantity: line.quantity },
      });

      await tx.productMovement.create({
        data: {
          productId: product.id,
          date,
          quantity: line.quantity,
          type: "PRODUCCION",
          reason: `Producción del ${dateLabel}`,
          createdById: user.id,
        },
      });

      for (const recipeItem of product.recipe) {
        const consumed = new Prisma.Decimal(recipeItem.quantityPerUnit).times(line.quantity);
        await tx.itemMovement.create({
          data: {
            itemId: recipeItem.itemId,
            date,
            quantity: consumed.negated(),
            type: "CONSUMO_PRODUCCION",
            reason: `Producción del ${dateLabel}`,
            createdById: user.id,
          },
        });
      }
    }
  });

  revalidatePath("/produccion");
  revalidatePath("/stock");
}
