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

export async function createBoxType(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const productId = String(formData.get("productId") || "");
  const label = String(formData.get("label") || "").trim();
  const unitsPerUnitRaw = String(formData.get("unitsPerBox") || "").trim();

  if (!productId) throw new Error("Falta el producto.");
  if (!label) throw new Error("Falta la etiqueta de la caja.");
  if (!unitsPerUnitRaw) throw new Error("Falta la cantidad de unidades por caja.");

  const unitsPerBox = toDecimal(unitsPerUnitRaw);
  if (!unitsPerBox.greaterThan(0)) {
    throw new Error("Las unidades por caja deben ser mayores a cero.");
  }

  await prisma.boxType.create({ data: { productId, label, unitsPerBox } });

  revalidatePath("/pallets");
}

export async function createBoxMovement(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const boxTypeId = String(formData.get("boxTypeId") || "");
  const boxType = await prisma.boxType.findUnique({ where: { id: boxTypeId } });
  if (!boxType) throw new Error("Tipo de caja inexistente.");

  const date = parseFormDate(formData.get("date"));
  const quantityRaw = String(formData.get("quantity") || "").trim();
  if (!quantityRaw) throw new Error("Falta la cantidad de cajas.");
  const quantity = toDecimal(quantityRaw);
  if (!quantity.greaterThan(0)) throw new Error("La cantidad debe ser mayor a cero.");

  const reason = String(formData.get("reason") || "").trim();
  if (!reason) throw new Error("El motivo es obligatorio.");

  const dateLabel = date.toLocaleDateString("es-AR");

  await prisma.$transaction(async (tx) => {
    await tx.boxMovement.create({
      data: {
        boxTypeId: boxType.id,
        date,
        quantity,
        type: "ARMADO",
        reason,
        createdById: user.id,
      },
    });

    const consumed = new Prisma.Decimal(boxType.unitsPerBox).times(quantity);
    await tx.productMovement.create({
      data: {
        productId: boxType.productId,
        date,
        quantity: consumed.negated(),
        type: "CONSUMO_ARMADO_CAJA",
        reason: `Armado de cajas "${boxType.label}" del ${dateLabel}`,
        createdById: user.id,
      },
    });
  });

  revalidatePath("/pallets");
  revalidatePath("/produccion");
}

export async function createPallet(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const date = parseFormDate(formData.get("date"));
  const label = String(formData.get("label") || "").trim() || null;
  const woodItemId = String(formData.get("woodItemId") || "");
  const filmItemId = String(formData.get("filmItemId") || "");
  const filmQuantityRaw = String(formData.get("filmQuantity") || "").trim();
  const palletCountRaw = String(formData.get("palletCount") || "1").trim();

  if (!woodItemId) throw new Error("Falta el insumo de pallet de madera.");
  if (!filmItemId) throw new Error("Falta el insumo de film.");
  if (!filmQuantityRaw) throw new Error("Falta la cantidad de film usada.");

  const filmQuantity = toDecimal(filmQuantityRaw);
  if (!filmQuantity.greaterThan(0)) throw new Error("La cantidad de film debe ser mayor a cero.");

  const palletCount = Math.max(1, Math.trunc(Number(palletCountRaw) || 1));

  const boxTypeIds = formData.getAll("boxTypeId").map(String);
  const boxQuantities = formData.getAll("boxQuantity").map(String);
  const lines = boxTypeIds
    .map((id, i) => ({ boxTypeId: id, quantity: toDecimal(boxQuantities[i]) }))
    .filter((l) => l.boxTypeId && l.quantity.greaterThan(0));

  if (lines.length === 0) {
    throw new Error("Cargá al menos una caja para el pallet.");
  }

  const dateLabel = date.toLocaleDateString("es-AR");

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < palletCount; i++) {
      const pallet = await tx.pallet.create({
        data: {
          label,
          date,
          woodItemId,
          filmItemId,
          filmQuantity,
          status: "ARMADO",
          createdById: user.id,
        },
      });

      const reason = `Armado de pallet ${label ? `"${label}" ` : ""}del ${dateLabel}`;

      await tx.itemMovement.create({
        data: {
          itemId: woodItemId,
          date,
          quantity: new Prisma.Decimal(-1),
          type: "CONSUMO_PALLET",
          reason,
          createdById: user.id,
        },
      });

      await tx.itemMovement.create({
        data: {
          itemId: filmItemId,
          date,
          quantity: filmQuantity.negated(),
          type: "CONSUMO_PALLET",
          reason,
          createdById: user.id,
        },
      });

      for (const line of lines) {
        await tx.palletBox.create({
          data: { palletId: pallet.id, boxTypeId: line.boxTypeId, quantity: line.quantity },
        });
        await tx.boxMovement.create({
          data: {
            boxTypeId: line.boxTypeId,
            date,
            quantity: line.quantity.negated(),
            type: "CONSUMO_PALLET",
            reason,
            createdById: user.id,
          },
        });
      }
    }
  });

  revalidatePath("/pallets");
  revalidatePath("/stock");
}
