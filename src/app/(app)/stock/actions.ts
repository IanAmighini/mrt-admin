"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import type { Prisma, SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";
import { parseNumeroEscrito } from "@/lib/money";
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

  if (!name) throw new UserError("El nombre es obligatorio.");
  if (!unit) throw new UserError("La unidad de medida es obligatoria.");
  if (!CATEGORIES.includes(category)) throw new UserError("Elegí una categoría válida.");

  // Se normalizan acá y no al guardar: son columnas Decimal y un "1.500,25" tal cual las rompe.
  const minStock = minStockRaw ? parseNumeroEscrito(minStockRaw, "stock mínimo") : null;
  const unitCost = unitCostRaw ? parseNumeroEscrito(unitCostRaw, "costo unitario") : null;
  const stockInicial = stockInicialRaw ? parseNumeroEscrito(stockInicialRaw, "stock inicial") : null;

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
        minStock,
        unitCost,
      },
    });

    if (stockInicial && !stockInicial.isZero()) {
      await tx.itemMovement.create({
        data: {
          itemId: item.id,
          date: new Date(),
          quantity: stockInicial,
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
 * Los parámetros de la ficha de un insumo. El costo es obligatorio, pero el **mínimo se puede
 * vaciar**: dejarlo en blanco es la forma de decir "no me avises más por este insumo", y sin eso no
 * habría manera de sacarlo del control de faltantes.
 *
 * Los tres campos de envase (preforma, unidades por pallet y soplado) sólo aparecen en el
 * formulario para la categoría ENVASES, y vaciarlos también los limpia — es lo que permite dar de
 * alta un formato nuevo sin una migración.
 */
export async function updateItemAjustes(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const itemId = String(formData.get("itemId") || "");
  const unitCostRaw = String(formData.get("unitCost") || "").trim();
  const minStockRaw = String(formData.get("minStock") || "").trim();
  if (!itemId) throw new UserError("Falta el insumo.");
  if (!unitCostRaw) throw new UserError("Falta el costo unitario.");
  const unitCost = parseNumeroEscrito(unitCostRaw, "costo unitario");
  const minStock = minStockRaw ? parseNumeroEscrito(minStockRaw, "stock mínimo") : null;
  if (minStock?.isNegative()) {
    throw new UserError("El stock mínimo no puede ser negativo.");
  }

  // `null` en el FormData significa que el formulario no traía el campo (no es un envase), y ahí no
  // hay que tocar el valor guardado. Un string vacío sí es "borralo".
  const datosDeEnvase: Prisma.ItemUpdateInput = {};
  const preformaRaw = formData.get("preformaId");
  if (preformaRaw !== null) {
    const id = String(preformaRaw).trim();
    datosDeEnvase.preforma = id ? { connect: { id } } : { disconnect: true };
  }
  const unitsPerPalletRaw = formData.get("unitsPerPallet");
  if (unitsPerPalletRaw !== null) {
    const raw = String(unitsPerPalletRaw).trim();
    const n = raw ? parseNumeroEscrito(raw, "unidades por pallet") : null;
    if (n && !n.greaterThan(0)) throw new UserError("Las unidades por pallet tienen que ser mayores a cero.");
    datosDeEnvase.unitsPerPallet = n ? n.toNumber() : null;
  }
  const sopladoRaw = formData.get("precioSopladoUsd");
  if (sopladoRaw !== null) {
    const raw = String(sopladoRaw).trim();
    datosDeEnvase.precioSopladoUsd = raw ? parseNumeroEscrito(raw, "soplado en U$S") : null;
  }

  const item = await prisma.item.update({
    where: { id: itemId },
    data: { unitCost, minStock, ...datosDeEnvase },
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
