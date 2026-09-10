"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { Prisma, type DocumentType, type EntityType, type ItemMovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney, formatQuantity, parseNumeroEscrito } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { ITEM_MOVEMENT_TYPE_LABELS } from "@/lib/labels";

const MOVEMENT_TYPES: ItemMovementType[] = ["INGRESO", "AJUSTE", "MERMA", "VENTA"];

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

export async function createItemMovement(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const itemId = String(formData.get("itemId") || "");
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) notFound();

  const type = String(formData.get("type") || "") as ItemMovementType;
  if (!MOVEMENT_TYPES.includes(type)) throw new UserError("Tipo de movimiento inválido.");

  const date = parseFormDate(formData.get("date"));
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) throw new UserError("El motivo es obligatorio.");

  const effect = String(formData.get("effect") || "SUMA");
  const sourceKgRaw = String(formData.get("sourceKg") || "").trim();
  const conversionFactorRaw = String(formData.get("conversionFactor") || "").trim();

  let quantity: Prisma.Decimal;
  let sourceKg: Prisma.Decimal | null = null;
  let conversionFactor: Prisma.Decimal | null = null;

  if (sourceKgRaw && conversionFactorRaw) {
    sourceKg = parseNumeroEscrito(sourceKgRaw, "kilos");
    conversionFactor = parseNumeroEscrito(conversionFactorRaw, "factor de conversión");
    quantity = sourceKg.times(conversionFactor);
  } else {
    const quantityRaw = String(formData.get("quantity") || "").trim();
    if (!quantityRaw) throw new UserError("Falta la cantidad.");
    quantity = parseNumeroEscrito(quantityRaw, "cantidad");
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

/**
 * Vende un insumo: descuenta stock y carga la plata en la cuenta corriente de quien lo recibe, en
 * una sola operación. Es lo que hace falta para el pallet descartable, que entra gratis con las
 * compras y después se le vende al proveedor de pallets normalizados.
 *
 * **El tipo de comprobante sale de a quién se le vende**, y eso es lo que hace que el signo quede
 * bien sin que nadie tenga que pensarlo. El saldo de una cuenta significa cosas opuestas según el
 * tipo de entidad: en un cliente, positivo es lo que nos debe; en un proveedor, lo que le debemos.
 *
 *   - Cliente   -> NOTA_DEBITO,  que `getDocumentEffect` suma  -> nos debe más.
 *   - Proveedor -> NOTA_CREDITO, que resta                     -> le debemos menos.
 *
 * Los dos son tipos que la cuenta corriente ya sabe editar y borrar, así que no hace falta ninguna
 * pantalla nueva para corregir una venta cargada mal.
 */
export async function venderInsumo(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const itemId = String(formData.get("itemId") || "");
  const entityId = String(formData.get("entityId") || "");
  if (!itemId) throw new UserError("Falta el insumo.");
  if (!entityId) throw new UserError("Elegí a quién se le vende.");

  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new UserError("Elegí el circuito.");

  const date = parseFormDate(formData.get("date"));
  const quantity = parseNumeroEscrito(String(formData.get("quantity") || ""), "cantidad");
  const unitPrice = parseNumeroEscrito(String(formData.get("unitPrice") || ""), "precio unitario");
  if (!quantity.greaterThan(0)) throw new UserError("La cantidad tiene que ser mayor a cero.");
  if (unitPrice.isNegative()) throw new UserError("El precio no puede ser negativo.");

  const number = String(formData.get("number") || "").trim();
  const notes = String(formData.get("notes") || "").trim() || null;

  const [item, account] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId } }),
    prisma.account.findUnique({
      where: { entityId_circuit: { entityId, circuit } },
      include: { entity: true },
    }),
  ]);
  if (!item) throw new UserError("El insumo ya no existe.");
  if (!account) throw new UserError("No se encontró la cuenta de esa entidad.");
  if (!item.llevaStock) {
    throw new UserError(
      `"${item.name}" no lleva stock, así que no se puede vender desde acá. Cargalo como un movimiento en la cuenta corriente.`
    );
  }

  const tipo = tipoDeComprobanteParaVenta(account.entity.type, formData.get("efecto"));
  const total = quantity.times(unitPrice);
  const detalle = `Venta de ${formatQuantity(quantity, item.unit)} de ${item.name}`;

  await prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        accountId: account.id,
        type: tipo,
        number: number || `VI-${item.slug}-${date.getTime()}`,
        date,
        currency: "ARS",
        netAmount: total,
        totalAmount: total,
        reason: notes ? `${detalle} — ${notes}` : detalle,
        createdById: user.id,
      },
    });

    await tx.itemMovement.create({
      data: {
        itemId,
        date,
        quantity: quantity.negated(),
        type: "VENTA",
        reason: `${detalle} — ${account.entity.name}`,
        documentId: document.id,
        createdById: user.id,
      },
    });

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Venta de insumo",
      entityId: document.id,
      summary: `${detalle} — ${account.entity.name} — ${formatMoney(total)}`,
    });
  });

  revalidatePath(`/stock/${item.slug}`);
  revalidatePath("/stock");
  revalidatePath(`/cuentas-corrientes/${account.entity.slug}`);
}

/**
 * Un cliente que además es proveedor no permite deducir el signo, así que ahí lo elige el
 * formulario. Para el resto no se pregunta: se sabe.
 */
function tipoDeComprobanteParaVenta(
  entityType: EntityType,
  efecto: FormDataEntryValue | null
): DocumentType {
  if (entityType === "CLIENTE") return "NOTA_DEBITO";
  if (entityType === "PROVEEDOR") return "NOTA_CREDITO";
  const elegido = String(efecto || "");
  if (elegido === "NOS_DEBE") return "NOTA_DEBITO";
  if (elegido === "LE_DEBEMOS_MENOS") return "NOTA_CREDITO";
  throw new UserError(
    "Esta entidad es cliente y proveedor a la vez: elegí si la venta se le cobra o se le descuenta de lo que le debemos."
  );
}
