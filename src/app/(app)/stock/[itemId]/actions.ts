"use server";

import { UserError } from "@/lib/user-error";
import { reimputarEntidades } from "@/lib/imputacion";
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
import { aLaMonedaDeLaCuenta, leerCotizacion, monedaEscrita } from "@/lib/moneda";

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
    // conversión: dividir rollos de stretch por 0,92 no significa nada.
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

/** Lo que se mira de una venta de insumo en Actividad. */
const CAMPOS_DE_LA_VENTA = {
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
} as const;

/** Las ventas de insumos se numeran solas: VI-00001, VI-00002… */
async function proximoNumeroDeVenta(tx: Prisma.TransactionClient) {
  const ultimo = await tx.document.findFirst({
    where: { number: { startsWith: "VI-0" } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = ultimo ? Number(ultimo.number.slice(3)) + 1 : 1;
  return `VI-${String(n).padStart(5, "0")}`;
}

/**
 * Una venta de insumo, nueva o corregida: baja el stock y carga la plata en la cuenta de quien
 * compra, en una sola transacción. Si viene `documentId` es una corrección: se reescriben el
 * comprobante y el movimiento de stock que ya existían, así queda una sola operación con su
 * historial en vez de un borrado y una alta.
 *
 * El precio se escribe en pesos o en dólares y se guarda en la moneda de la cuenta de quien compra.
 * Antes iba siempre en pesos, y a Víctor Dilver —que se lleva en dólares— una venta quedó en pesos
 * dentro de su cuenta en dólares.
 */
async function guardarVenta(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "") || null;
  const itemId = String(formData.get("itemId") || "");
  const entityId = String(formData.get("entityId") || "");
  if (!itemId) throw new UserError("Falta el insumo.");
  if (!entityId) throw new UserError("Elegí a quién se le vende.");

  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new UserError("Elegí la cuenta.");

  const date = parseFormDate(formData.get("date"));
  const quantity = parseNumeroEscrito(String(formData.get("quantity") || ""), "cantidad");
  const precioEscrito = parseNumeroEscrito(String(formData.get("unitPrice") || ""), "precio unitario");
  if (!quantity.greaterThan(0)) throw new UserError("La cantidad tiene que ser mayor a cero.");
  if (precioEscrito.isNegative()) throw new UserError("El precio no puede ser negativo.");

  const numeroEscrito = String(formData.get("number") || "").trim();
  const notes = String(formData.get("notes") || "").trim() || null;

  const [item, account, anterior] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId } }),
    prisma.account.findUnique({
      where: { entityId_circuit: { entityId, circuit } },
      include: { entity: true },
    }),
    documentId
      ? prisma.document.findUnique({
          where: { id: documentId },
          include: {
            account: { include: { entity: true } },
            itemMovements: { where: { type: "VENTA" }, include: { item: true } },
          },
        })
      : null,
  ]);
  if (!item) throw new UserError("El insumo ya no existe.");
  if (!account) throw new UserError("No se encontró la cuenta de esa entidad.");
  if (!item.llevaStock) {
    throw new UserError(
      `"${item.name}" no lleva stock, así que no se puede vender desde acá. Cargalo como un movimiento en la cuenta corriente.`
    );
  }
  if (documentId && (!anterior || anterior.itemMovements.length !== 1)) {
    throw new UserError("Esa venta ya no existe.");
  }

  const moneda = account.entity.moneda;
  const { convertir, exchangeRate } = aLaMonedaDeLaCuenta(
    monedaEscrita(formData.get("currency"), moneda),
    moneda,
    leerCotizacion(formData.get("exchangeRate"))
  );
  const unitPrice = convertir(precioEscrito);
  const tipo = tipoDeComprobanteParaVenta(account.entity.type, formData.get("efecto"));
  const total = convertir(quantity.times(precioEscrito)).toDecimalPlaces(2);
  const detalle = `Venta de ${formatQuantity(quantity, item.unit)} de ${item.name}`;

  const foto = (d: {
    entidad: string;
    circuito: "BLANCO" | "NEGRO";
    tipo: DocumentType;
    number: string;
    date: Date;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    total: Prisma.Decimal;
    currency: "ARS" | "USD";
    notes: string | null;
  }) => ({
    insumo: item.name,
    aQuien: d.entidad,
    cuenta: CIRCUIT_LABELS[d.circuito],
    tipo: DOCUMENT_TYPE_LABELS[d.tipo],
    number: d.number,
    date: d.date,
    quantity: formatQuantity(d.quantity, item.unit),
    unitPrice: formatMoney(d.unitPrice, d.currency),
    total: formatMoney(d.total, d.currency),
    notes: d.notes,
  });

  await prisma.$transaction(async (tx) => {
    const number = numeroEscrito || anterior?.number || (await proximoNumeroDeVenta(tx));
    const datos = {
      accountId: account.id,
      type: tipo,
      number,
      date,
      currency: moneda,
      exchangeRate,
      netAmount: total,
      totalAmount: total,
      reason: notes ? `${detalle} — ${notes}` : detalle,
    };
    const movimiento = {
      itemId,
      date,
      quantity: quantity.negated(),
      reason: `${detalle} — ${account.entity.name}`,
    };

    if (anterior) {
      await tx.document.update({ where: { id: anterior.id }, data: datos });
      await tx.itemMovement.update({ where: { id: anterior.itemMovements[0].id }, data: movimiento });
    } else {
      const document = await tx.document.create({ data: { ...datos, createdById: user.id } });
      await tx.itemMovement.create({
        data: { ...movimiento, type: "VENTA", documentId: document.id, createdById: user.id },
      });
    }

    // El insumo de antes también: si se cambió de insumo, el viejo recupera lo que había salido.
    await asegurarSinNegativos(tx, { insumos: [itemId, ...(anterior ? [anterior.itemMovements[0].itemId] : [])] });

    const despues = foto({
      entidad: account.entity.name,
      circuito: account.circuit,
      tipo,
      number,
      date,
      quantity,
      unitPrice,
      total,
      currency: moneda,
      notes,
    });
    await logAudit(tx, {
      userId: user.id,
      action: anterior ? "UPDATE" : "CREATE",
      entityType: "Venta de insumo",
      entityId: anterior?.id ?? number,
      summary: `${detalle} — ${account.entity.name} — ${formatMoney(total, moneda)}`,
      cambios: diffDeCampos(
        anterior
          ? foto({
              entidad: anterior.account.entity.name,
              circuito: anterior.account.circuit,
              tipo: anterior.type,
              number: anterior.number,
              date: anterior.date,
              quantity: anterior.itemMovements[0].quantity.negated(),
              unitPrice: anterior.totalAmount.dividedBy(anterior.itemMovements[0].quantity.negated()),
              total: anterior.totalAmount,
              currency: anterior.currency,
              notes: anterior.reason?.split(" — ").slice(1).join(" — ") || null,
            })
          : null,
        despues,
        CAMPOS_DE_LA_VENTA
      ),
    });
  });

  await reimputarEntidades(account.entityId, anterior?.account.entityId);
  revalidatePath(`/stock/${item.slug}`);
  if (anterior && anterior.itemMovements[0].itemId !== itemId) revalidatePath(`/stock/${anterior.itemMovements[0].item.slug}`);
  revalidatePath("/stock");
  revalidatePath(`/cuentas-corrientes/${account.entity.slug}`);
  if (anterior) revalidatePath(`/cuentas-corrientes/${anterior.account.entity.slug}`);
}

export async function venderInsumo(formData: FormData) {
  formData.delete("documentId");
  await guardarVenta(formData);
}

export async function editarVentaDeInsumo(formData: FormData) {
  if (!formData.get("documentId")) throw new UserError("Falta la venta.");
  await guardarVenta(formData);
}

/** Borra una venta de insumo entera: la plata sale de la cuenta y el insumo vuelve al stock. */
export async function borrarVentaDeInsumo(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  const documentId = String(formData.get("documentId") || "");
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      account: { include: { entity: true } },
      itemMovements: { where: { type: "VENTA" }, include: { item: true } },
    },
  });
  if (!doc || doc.itemMovements.length === 0) throw new UserError("Esa venta ya no existe.");
  const mov = doc.itemMovements[0];

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.itemMovement.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });
    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Venta de insumo",
      entityId: documentId,
      summary: `${doc.reason ?? "Venta de insumo"} — ${doc.account.entity.name} — ${formatMoney(doc.totalAmount, doc.currency)}`,
    });
  });

  await reimputarEntidades(doc.account.entityId);
  revalidatePath(`/stock/${mov.item.slug}`);
  revalidatePath("/stock");
  revalidatePath(`/cuentas-corrientes/${doc.account.entity.slug}`);
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
