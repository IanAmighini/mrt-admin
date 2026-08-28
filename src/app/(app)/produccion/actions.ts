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

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  const str = String(value || "").trim();
  if (!str) return null;
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Un producto = una marca (nombre + tipo de aceite) en un formato (cajas x botellas por caja x
 * ml). Ambas se eligen de un catálogo reutilizable o se cargan nuevas acá mismo — así una marca
 * nueva puede usar un formato que ya existe (y viceversa) sin volver a tipear los números.
 */
export async function createProduct(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const marcaId = String(formData.get("marcaId") || "");
  let name: string;
  let oilType: string;

  if (marcaId && marcaId !== "__new__") {
    const marca = await prisma.marca.findUnique({ where: { id: marcaId } });
    if (!marca) throw new Error("La marca elegida ya no existe.");
    name = marca.name;
    oilType = marca.oilType;
  } else {
    name = String(formData.get("newMarcaName") || "").trim();
    oilType = String(formData.get("newMarcaOilType") || "").trim();
    if (!name) throw new Error("Falta el nombre de la marca.");
    if (!oilType) throw new Error("Falta el tipo de aceite.");

    await prisma.marca.upsert({
      where: { name_oilType: { name, oilType } },
      update: {},
      create: { name, oilType },
    });
  }

  const formatoId = String(formData.get("formatoId") || "");
  let presentation: string;
  let boxesPerPallet: number;
  let unitsPerBox: number;
  let bottleCapacityMl: string;

  if (formatoId && formatoId !== "__new__") {
    const formato = await prisma.formato.findUnique({ where: { id: formatoId } });
    if (!formato) throw new Error("El formato elegido ya no existe.");
    presentation = formato.presentation;
    boxesPerPallet = formato.boxesPerPallet;
    unitsPerBox = formato.unitsPerBox;
    bottleCapacityMl = formato.bottleCapacityMl.toString();
  } else {
    presentation = String(formData.get("newPresentation") || "").trim();
    const boxesPerPalletParsed = parseOptionalInt(formData.get("newBoxesPerPallet"));
    const unitsPerBoxParsed = parseOptionalInt(formData.get("newUnitsPerBox"));
    bottleCapacityMl = String(formData.get("newBottleCapacityMl") || "").trim();

    if (!presentation) throw new Error("Falta la presentación del formato.");
    if (!boxesPerPalletParsed || !unitsPerBoxParsed || !bottleCapacityMl) {
      throw new Error("Completá cajas por pallet, botellas por caja y capacidad de botella.");
    }
    boxesPerPallet = boxesPerPalletParsed;
    unitsPerBox = unitsPerBoxParsed;

    await prisma.formato.upsert({
      where: { presentation },
      update: { boxesPerPallet, unitsPerBox, bottleCapacityMl },
      create: { presentation, boxesPerPallet, unitsPerBox, bottleCapacityMl },
    });
  }

  const existing = await prisma.product.findFirst({ where: { name, oilType, presentation } });
  if (existing) {
    throw new Error(`Ya existe "${name} ${oilType}" en el formato "${presentation}".`);
  }

  await prisma.product.create({
    data: { name, oilType, presentation, boxesPerPallet, unitsPerBox, bottleCapacityMl },
  });

  revalidatePath("/produccion");
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
  const productIds = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity").map(String);

  const lines = productIds
    .map((productId, i) => ({ productId, quantity: toDecimal(quantities[i]) }))
    .filter((l) => l.productId && !l.quantity.isZero());

  if (lines.length === 0) {
    throw new Error(
      "Cargá al menos un ítem con producto y pallets (puede ser negativo, para reformateo)."
    );
  }

  const dateLabel = date.toLocaleDateString("es-AR");

  await prisma.$transaction(async (tx) => {
    const run = await tx.productionRun.create({
      data: { date, notes, createdById: user.id },
    });

    for (const line of lines) {
      const product = await tx.product.findUnique({
        where: { id: line.productId },
        include: { recipe: true },
      });
      if (!product) throw new Error("Alguno de los productos seleccionados ya no existe.");

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
