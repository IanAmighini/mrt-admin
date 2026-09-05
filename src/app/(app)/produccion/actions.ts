"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import { Prisma, type AuditAction, type SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";
import { getSetting, setSetting } from "@/lib/settings";
import { resolveOrCreateProduct } from "@/lib/products";
import { syncPedidoStatuses } from "@/lib/pedidos";
import { logAudit } from "@/lib/audit";

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

export async function updateOilEfficiency(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const value = String(formData.get("oilFillEfficiencyPercent") || "").trim();
  const num = toDecimal(value);
  if (!num.greaterThan(0) || num.greaterThan(100)) {
    throw new UserError("La eficiencia debe ser un porcentaje entre 0 y 100.");
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

/** Núcleo compartido por createProductionRun y updateProductionRun — así una edición queda como un
 * solo UPDATE en el log, no un DELETE + CREATE. */
async function createProductionRunCore(
  user: { id: string },
  formData: FormData,
  auditAction: AuditAction,
  /** Al editar: la corrida que esta reemplaza. Se borra DENTRO de la transacción, ver updateProductionRun. */
  replaceRunId?: string
) {
  const date = parseFormDate(formData.get("date"));
  const notes = String(formData.get("notes") || "").trim() || null;
  const marcaIds = formData.getAll("marcaId").map(String);
  const formatoIds = formData.getAll("formatoId").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const tapaUsadaIds = formData.getAll("tapaUsadaItemId").map(String);
  const cajaUsadaIds = formData.getAll("cajaUsadaItemId").map(String);

  // Los campos del formulario llegan como arrays paralelos que se aparean por posición. Si alguno
  // viniera con distinto largo, los reemplazos caerían en la fila equivocada y descontarían del
  // insumo que no era, sin que nadie lo note. Mejor romper fuerte.
  if (
    formatoIds.length !== marcaIds.length ||
    quantities.length !== marcaIds.length ||
    tapaUsadaIds.length !== marcaIds.length ||
    cajaUsadaIds.length !== marcaIds.length
  ) {
    throw new UserError("El formulario llegó incompleto — recargá la página y volvé a cargar la producción.");
  }

  const lines = marcaIds
    .map((marcaId, i) => ({
      marcaId,
      formatoId: formatoIds[i] || "",
      quantity: toDecimal(quantities[i] || "0"),
      tapaUsadaItemId: tapaUsadaIds[i] || "",
      cajaUsadaItemId: cajaUsadaIds[i] || "",
    }))
    .filter((l) => l.marcaId && l.formatoId && !l.quantity.isZero());

  if (lines.length === 0) {
    throw new UserError(
      "Cargá al menos un ítem con marca, formato y pallets (puede ser negativo, para reformateo)."
    );
  }

  // Los reemplazos se validan contra la base y no solo con el filtro del desplegable: un POST
  // armado a mano podría, si no, descontar tapas del aceite.
  const reemplazoIds = Array.from(
    new Set(lines.flatMap((l) => [l.tapaUsadaItemId, l.cajaUsadaItemId]).filter(Boolean))
  );
  const reemplazos = reemplazoIds.length
    ? await prisma.item.findMany({
        where: { id: { in: reemplazoIds } },
        select: { id: true, name: true, category: true },
      })
    : [];
  const reemplazoPorId = new Map(reemplazos.map((i) => [i.id, i]));
  for (const line of lines) {
    for (const [itemId, categoria, rol] of [
      [line.tapaUsadaItemId, "TAPAS", "tapa"],
      [line.cajaUsadaItemId, "CAJAS", "caja"],
    ] as const) {
      if (!itemId) continue;
      const item = reemplazoPorId.get(itemId);
      if (!item) throw new UserError(`El insumo elegido como ${rol} usada ya no existe.`);
      if (item.category !== categoria) {
        throw new UserError(`"${item.name}" no es una ${rol}.`);
      }
    }
  }

  const dateLabel = date.toLocaleDateString("es-AR");

  // Lo necesita la receta que se arma sola al crear un producto nuevo. Se lee acá y no adentro de
  // la transacción para no gastarle una consulta a cada línea.
  const oilFillEfficiencyPercent = toDecimal(await getSetting("oilFillEfficiencyPercent", "100"));

  await prisma.$transaction(async (tx) => {
    // Borrar acá adentro y no antes: si el alta falla, la corrida original tiene que seguir
    // existiendo. Las líneas y sus movimientos de producto/insumo se van en cascada.
    if (replaceRunId) await tx.productionRun.delete({ where: { id: replaceRunId } });

    const run = await tx.productionRun.create({
      data: { date, notes, createdById: user.id },
    });

    for (const line of lines) {
      const product = await resolveOrCreateProduct(tx, line.marcaId, line.formatoId, oilFillEfficiencyPercent);

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

      // Los productos nuevos nacen con receta, pero los que se crearon antes de que eso existiera
      // pueden no tenerla. Envasar sin receta no descuenta un solo insumo y no avisa nada: el
      // faltante recién aparece cuando alguien cuenta el stock físico. Mejor no dejar cargar.
      if (product.recipe.length === 0) {
        throw new UserError(
          `${product.name} ${product.oilType} ${product.presentation} no tiene receta cargada, así que producirlo no descontaría ningún insumo. Cargala desde la ficha del producto.`
        );
      }

      // La receta dice CUÁNTO se consume; el reemplazo solo cambia DE QUÉ insumo sale.
      const reemplazoPorCategoria: Partial<Record<SupplierCategory, string>> = {
        ...(line.tapaUsadaItemId ? { TAPAS: line.tapaUsadaItemId } : {}),
        ...(line.cajaUsadaItemId ? { CAJAS: line.cajaUsadaItemId } : {}),
      };
      for (const categoria of Object.keys(reemplazoPorCategoria) as SupplierCategory[]) {
        const rol = categoria === "TAPAS" ? "tapa" : "caja";
        const enReceta = product.recipe.filter((r) => r.item.category === categoria);
        // Aceptar la instrucción y descartarla en silencio dejaría el stock mal sin que nadie se
        // entere, así que se avisa.
        if (enReceta.length === 0) {
          throw new UserError(
            `${product.name} ${product.presentation} no tiene ${rol} en la receta — cargala antes de indicar cuál usaste.`
          );
        }
        if (enReceta.length > 1) {
          throw new UserError(
            `${product.name} ${product.presentation} tiene más de una ${rol} en la receta — corregila antes de indicar cuál usaste.`
          );
        }
      }

      await tx.itemMovement.createMany({
        data: product.recipe.map((recipeItem) => {
          const consumed = new Prisma.Decimal(recipeItem.quantityPerUnit).times(line.quantity);
          const reemplazo = reemplazoPorCategoria[recipeItem.item.category];
          const usado = reemplazo && reemplazo !== recipeItem.itemId ? reemplazo : null;
          return {
            itemId: usado ?? recipeItem.itemId,
            date,
            quantity: consumed.negated(),
            type: "CONSUMO_PRODUCCION" as const,
            // Que hubo reemplazo queda en el texto, que es lo que ya se ve en el kardex.
            reason: usado
              ? `Producción del ${dateLabel} — en lugar de ${recipeItem.item.name}`
              : `Producción del ${dateLabel}`,
            productionLineId: productionLine.id,
            createdById: user.id,
          };
        }),
      });
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
  if (!run) throw new UserError("La carga de producción ya no existe.");

  await createProductionRunCore(user, formData, "UPDATE", runId);
}

export async function deleteProductionRun(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const runId = String(formData.get("runId") || "");
  const run = await prisma.productionRun.findUnique({ where: { id: runId } });
  if (!run) throw new UserError("La carga de producción ya no existe.");

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
