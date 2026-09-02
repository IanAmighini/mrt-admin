"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { Prisma, type ItemMovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatQuantity, toDecimal } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { ITEM_MOVEMENT_TYPE_LABELS } from "@/lib/labels";

const MOVEMENT_TYPES: ItemMovementType[] = ["INGRESO", "AJUSTE", "MERMA", "VENTA"];

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new Error("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

export async function createItemMovement(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const itemId = String(formData.get("itemId") || "");
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) notFound();

  const type = String(formData.get("type") || "") as ItemMovementType;
  if (!MOVEMENT_TYPES.includes(type)) throw new Error("Tipo de movimiento inválido.");

  const date = parseFormDate(formData.get("date"));
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) throw new Error("El motivo es obligatorio.");

  const effect = String(formData.get("effect") || "SUMA");
  const sourceKgRaw = String(formData.get("sourceKg") || "").trim();
  const conversionFactorRaw = String(formData.get("conversionFactor") || "").trim();

  let quantity: Prisma.Decimal;
  let sourceKg: Prisma.Decimal | null = null;
  let conversionFactor: Prisma.Decimal | null = null;

  if (sourceKgRaw && conversionFactorRaw) {
    sourceKg = toDecimal(sourceKgRaw);
    conversionFactor = toDecimal(conversionFactorRaw);
    quantity = sourceKg.times(conversionFactor);
  } else {
    const quantityRaw = String(formData.get("quantity") || "").trim();
    if (!quantityRaw) throw new Error("Falta la cantidad.");
    quantity = toDecimal(quantityRaw);
  }

  if (type !== "INGRESO" && effect === "RESTA") {
    quantity = quantity.negated();
  }

  await prisma.itemMovement.create({
    data: {
      itemId: item.id,
      date,
      quantity,
      type,
      reason,
      sourceKg,
      conversionFactor,
      createdById: user.id,
    },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Movimiento de insumo",
    entityId: item.id,
    summary: `${ITEM_MOVEMENT_TYPE_LABELS[type]} — ${item.name} — ${formatQuantity(quantity, item.unit)}`,
  });

  revalidatePath(`/stock/${item.slug}`);
  revalidatePath("/stock");
}
