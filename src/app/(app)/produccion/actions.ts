"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";
import { setSetting } from "@/lib/settings";

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new Error("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

export async function updateOilEfficiency(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const value = String(formData.get("oilFillEfficiencyPercent") || "").trim();
  const num = toDecimal(value);
  if (!num.greaterThan(0) || num.greaterThan(100)) {
    throw new Error("La eficiencia debe ser un porcentaje entre 0 y 100.");
  }

  await setSetting("oilFillEfficiencyPercent", value);

  revalidatePath("/produccion");
}

export async function createProductionRun(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const date = parseFormDate(formData.get("date"));
  const notes = String(formData.get("notes") || "").trim() || null;
  const marcaIds = formData.getAll("marcaId").map(String);
  const formatoIds = formData.getAll("formatoId").map(String);
  const quantities = formData.getAll("quantity").map(String);

  const lines = marcaIds
    .map((marcaId, i) => ({
      marcaId,
      formatoId: formatoIds[i] || "",
      quantity: toDecimal(quantities[i] || "0"),
    }))
    .filter((l) => l.marcaId && l.formatoId && !l.quantity.isZero());

  if (lines.length === 0) {
    throw new Error(
      "Cargá al menos un ítem con marca, formato y pallets (puede ser negativo, para reformateo)."
    );
  }

  const dateLabel = date.toLocaleDateString("es-AR");

  await prisma.$transaction(async (tx) => {
    const run = await tx.productionRun.create({
      data: { date, notes, createdById: user.id },
    });

    for (const line of lines) {
      const marca = await tx.marca.findUnique({ where: { id: line.marcaId } });
      if (!marca) throw new Error("Alguna de las marcas seleccionadas ya no existe.");
      const formato = await tx.formato.findUnique({ where: { id: line.formatoId } });
      if (!formato) throw new Error("Alguno de los formatos seleccionados ya no existe.");

      let product = await tx.product.findFirst({
        where: { name: marca.name, oilType: marca.oilType, presentation: formato.presentation },
        include: { recipe: true },
      });
      if (!product) {
        product = await tx.product.create({
          data: {
            name: marca.name,
            oilType: marca.oilType,
            presentation: formato.presentation,
            boxesPerPallet: formato.boxesPerPallet,
            unitsPerBox: formato.unitsPerBox,
            bottleCapacityMl: formato.bottleCapacityMl,
          },
          include: { recipe: true },
        });
      }

      const productionLine = await tx.productionLine.create({
        data: { productionRunId: run.id, productId: product.id, quantity: line.quantity },
      });

      await tx.productMovement.create({
        data: {
          productId: product.id,
          date,
          quantity: line.quantity,
          type: "PRODUCCION",
          reason: `Producción del ${dateLabel}`,
          productionLineId: productionLine.id,
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
            productionLineId: productionLine.id,
            createdById: user.id,
          },
        });
      }
    }
  });

  revalidatePath("/produccion");
  revalidatePath("/stock");
}

/**
 * Editar una producción = borrar la carga existente (las líneas y los movimientos de
 * producto/insumo vinculados se van en cascada) y volver a correr createProductionRun con los
 * datos nuevos — mismo patrón que remitos y pedidos.
 */
export async function updateProductionRun(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const runId = String(formData.get("runId") || "");
  const run = await prisma.productionRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("La carga de producción ya no existe.");

  await prisma.productionRun.delete({ where: { id: runId } });

  await createProductionRun(formData);
}

export async function deleteProductionRun(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const runId = String(formData.get("runId") || "");
  const run = await prisma.productionRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("La carga de producción ya no existe.");

  await prisma.productionRun.delete({ where: { id: runId } });

  revalidatePath("/produccion");
  revalidatePath("/stock");
}
