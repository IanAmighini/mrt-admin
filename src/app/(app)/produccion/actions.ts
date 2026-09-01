"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";
import { setSetting } from "@/lib/settings";
import { resolveOrCreateProduct } from "@/lib/products";
import { syncPedidoStatuses } from "@/lib/pedidos";
import { logAudit } from "@/lib/audit";

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new Error("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

export async function updateOilEfficiency(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const value = String(formData.get("oilFillEfficiencyPercent") || "").trim();
  const num = toDecimal(value);
  if (!num.greaterThan(0) || num.greaterThan(100)) {
    throw new Error("La eficiencia debe ser un porcentaje entre 0 y 100.");
  }

  await setSetting("oilFillEfficiencyPercent", value);

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Configuración",
    summary: `Eficiencia de llenado de aceite — ${value}%`,
  });

  revalidatePath("/produccion");
}

/** Núcleo compartido por createProductionRun y updateProductionRun (que borra y vuelve a llamar
 * a este núcleo) — así una edición queda como un solo UPDATE en el log, no un DELETE + CREATE. */
async function createProductionRunCore(
  user: { id: string },
  formData: FormData,
  auditAction: AuditAction
) {
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
      const product = await resolveOrCreateProduct(tx, line.marcaId, line.formatoId);

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

      if (product.recipe.length > 0) {
        await tx.itemMovement.createMany({
          data: product.recipe.map((recipeItem) => {
            const consumed = new Prisma.Decimal(recipeItem.quantityPerUnit).times(line.quantity);
            return {
              itemId: recipeItem.itemId,
              date,
              quantity: consumed.negated(),
              type: "CONSUMO_PRODUCCION" as const,
              reason: `Producción del ${dateLabel}`,
              productionLineId: productionLine.id,
              createdById: user.id,
            };
          }),
        });
      }
    }

    await syncPedidoStatuses(tx);

    await logAudit(tx, {
      userId: user.id,
      action: auditAction,
      entityType: "Producción",
      entityId: run.id,
      summary: `Producción del ${dateLabel} — ${lines.length} línea(s)`,
    });
  }, { timeout: 20000 });

  revalidatePath("/produccion");
  revalidatePath("/stock");
  revalidatePath("/pedidos");
}

export async function createProductionRun(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  await createProductionRunCore(user, formData, "CREATE");
}

/**
 * Editar una producción = borrar la carga existente (las líneas y los movimientos de
 * producto/insumo vinculados se van en cascada) y volver a correr el mismo núcleo con los datos
 * nuevos — mismo patrón que remitos y pedidos, pero logueando un solo UPDATE.
 */
export async function updateProductionRun(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const runId = String(formData.get("runId") || "");
  const run = await prisma.productionRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("La carga de producción ya no existe.");

  await prisma.productionRun.delete({ where: { id: runId } });

  await createProductionRunCore(user, formData, "UPDATE");
}

export async function deleteProductionRun(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const runId = String(formData.get("runId") || "");
  const run = await prisma.productionRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("La carga de producción ya no existe.");

  await prisma.productionRun.delete({ where: { id: runId } });

  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Producción",
    entityId: runId,
    summary: `Producción del ${run.date.toLocaleDateString("es-AR")}`,
  });

  revalidatePath("/produccion");
  revalidatePath("/stock");
}
