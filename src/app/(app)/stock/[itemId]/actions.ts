"use server";

import { UserError } from "@/lib/user-error";
import { parseFecha } from "@/lib/period";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { Prisma, type DocumentType, type EntityType, type ItemMovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney, formatQuantity, parseNumeroEscrito } from "@/lib/money";
import { diffDeCampos, logAudit } from "@/lib/audit";
import { asegurarSinNegativos } from "@/lib/sin-negativos";
import { DENSIDAD_ACEITE, litrosDeKilos } from "@/lib/aceite";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS, ITEM_MOVEMENT_TYPE_LABELS } from "@/lib/labels";

const MOVEMENT_TYPES: ItemMovementType[] = ["INGRESO", "AJUSTE", "MERMA", "VENTA"];

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return parseFecha(str);
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

  let quantity: Prisma.Decimal;
  let sourceKg: Prisma.Decimal | null = null;
  // Se guarda la densidad con la que se convirtió, para poder reconstruir los litros desde el ticket.
  let conversionFactor: Prisma.Decimal | null = null;

  if (sourceKgRaw) {
    // Sólo el aceite entra por kilos. Con cualquier otro insumo esto es un error de carga, no una
    // conversión: dividir rollos de stretch por 0,91 no significa nada.
    if (item.category !== "ACEITE") {
      throw new UserError("Los kilos son sólo para el aceite. Para este insumo cargá la cantidad.");
    }
    sourceKg = parseNumeroEscrito(sourceKgRaw, "kilos");
    if (!sourceKg.greaterThan(0)) throw new UserError("Los kilos tienen que ser mayores a cero.");
    quantity = litrosDeKilos(sourceKg);
    conversionFactor = DENSIDAD_ACEITE;
  } else {
    const quantityRaw = String(formData.get("quantity") || "").trim();
    if (!quantityRaw) throw new UserError("Falta la cantidad.");
    quantity = parseNumeroEscrito(quantityRaw, "cantidad");
  }

  if (type !== "INGRESO" && effect === "RESTA") {
    quantity = quantity.negated();
  }

  await prisma.$transaction(async (tx) => {
    await tx.itemMovement.create({
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
    // Un ajuste o una merma no pueden sacar más de lo que hay.
    await asegurarSinNegativos(tx, { insumos: [item.id] });
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Movimiento de insumo",
    entityId: item.id,
    summary: `${ITEM_MOVEMENT_TYPE_LABELS[type]} — ${item.name} — ${formatQuantity(quantity, item.unit)}`,
    cambios: diffDeCampos(
      null,
      {
        tipo: ITEM_MOVEMENT_TYPE_LABELS[type],
        insumo: item.name,
        date,
        quantity: formatQuantity(quantity, item.unit),
        reason,
        sourceKg,
        conversionFactor,
      },
      {
        tipo: "Tipo",
        insumo: "Insumo",
        date: "Fecha",
        quantity: "Cantidad",
        reason: "Motivo",
        sourceKg: "Kilos",
        conversionFactor: "Densidad",
      }
    ),
  });

  revalidatePath(`/stock/${item.slug}`);
  revalidatePath("/stock");
}

/**
 * Borra un movimiento cargado a mano desde esta misma ficha.
 *
 * Hasta ahora un ingreso mal cargado no se podía tocar: quedaba ahí y había que compensarlo con un
 * ajuste en contra, que arregla el saldo pero deja los dos números falsos en el kardex. Pasó con
 * una entrega de aceite cargada con el factor de conversión equivocado —789 millones de litros— y
 * la única salida fue entrar a la base.
 *
 * **Sólo los movimientos sueltos.** El que trae una compra o el que descuenta una producción no se
 * borran desde acá: son la consecuencia de otra cosa, y sacarlos por separado dejaría la compra
 * diciendo que entró mercadería que el stock no tiene. Esos se corrigen en su origen, que ya
 * reescribe el movimiento solo.
 */
export async function borrarMovimientoDeInsumo(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const movementId = String(formData.get("movementId") || "");
  const movimiento = await prisma.itemMovement.findUnique({
    where: { id: movementId },
    include: { item: { select: { name: true, slug: true, unit: true } } },
  });
  if (!movimiento) throw new UserError("El movimiento ya no existe.");

  if (movimiento.documentId) {
    throw new UserError(
      "Este movimiento lo generó una compra o una venta: corregí el comprobante y el stock se acomoda solo."
    );
  }
  if (movimiento.productionLineId) {
    throw new UserError(
      "Este movimiento lo generó una producción: editá la producción y el consumo se vuelve a calcular solo."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.itemMovement.delete({ where: { id: movementId } });
    // Borrar un ingreso del que ya se consumió dejaría el stock en rojo desde ese día.
    await asegurarSinNegativos(tx, { insumos: [movimiento.itemId] });

    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Movimiento de insumo",
      entityId: movimiento.itemId,
      summary: `${ITEM_MOVEMENT_TYPE_LABELS[movimiento.type]} — ${movimiento.item.name} — ${formatQuantity(movimiento.quantity, movimiento.item.unit)}`,
      cambios: diffDeCampos(
        {
          tipo: ITEM_MOVEMENT_TYPE_LABELS[movimiento.type],
          insumo: movimiento.item.name,
          date: movimiento.date,
          quantity: formatQuantity(movimiento.quantity, movimiento.item.unit),
          reason: movimiento.reason,
          sourceKg: movimiento.sourceKg,
          conversionFactor: movimiento.conversionFactor,
        },
        null,
        {
          tipo: "Tipo",
          insumo: "Insumo",
          date: "Fecha",
          quantity: "Cantidad",
          reason: "Motivo",
          sourceKg: "Kilos",
          conversionFactor: "Densidad",
        }
      ),
    });
  });

  revalidatePath(`/stock/${movimiento.item.slug}`);
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

    await asegurarSinNegativos(tx, { insumos: [itemId] });

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Venta de insumo",
      entityId: document.id,
      summary: `${detalle} — ${account.entity.name} — ${formatMoney(total)}`,
      cambios: diffDeCampos(
        null,
        {
          insumo: item.name,
          aQuien: account.entity.name,
          cuenta: CIRCUIT_LABELS[account.circuit],
          tipo: DOCUMENT_TYPE_LABELS[tipo],
          number: document.number,
          date,
          quantity: formatQuantity(quantity, item.unit),
          unitPrice: formatMoney(unitPrice),
          total: formatMoney(total),
          notes,
        },
        {
          insumo: "Insumo",
          aQuien: "A qui\u00e9n",
          cuenta: "Cuenta",
          tipo: "Comprobante",
          number: "N\u00famero",
          date: "Fecha",
          quantity: "Cantidad",
          unitPrice: "Precio unitario",
          total: "Total",
          notes: "Notas",
        }
      ),
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
