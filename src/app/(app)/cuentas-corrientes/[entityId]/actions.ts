"use server";

import { UserError } from "@/lib/user-error";
import { formatFecha, parseFecha } from "@/lib/period";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import {
  Prisma,
  type Circuit,
  type Currency,
  type DocumentType,
  type EstadoDevolucion,
  type ExpenseCategory,
  type PaymentMethod,
  type RetentionKind,
  type TreasuryMovementCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { DEFAULT_IVA_RATE, formatMoney, formatNumeroExacto, parseNumeroEscrito, parseNumeroOpcional, toDecimal, ZERO } from "@/lib/money";
import { impuestosDeCompra, impuestosDeNota, leerGastoDelForm } from "@/lib/impuestos";
import { allocateFifo, defaultDueDate, getDocumentEffect } from "@/lib/ledger";
import {
  CIRCUIT_LABELS,
  DOCUMENT_TYPE_LABELS,
  ESTADO_DEVOLUCION_LABELS,
  EXPENSE_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  RETENTION_KIND_LABELS,
} from "@/lib/labels";
import { PROVEEDOR_DIRECTO_VALUE } from "@/lib/payment-destino";
import { circuitoDeTesoreria, motivoMetodoInvalido } from "@/lib/pagos";
import { crearChequeRecibido, devolverChequesALaCartera, entregarCheques, esMetodoCheque } from "@/lib/cheques";
import { diffDeCampos, logAudit } from "@/lib/audit";
import { asegurarCajaAlcanza, asegurarSinNegativos } from "@/lib/sin-negativos";
import { DENSIDAD_ACEITE, litrosDeKilos } from "@/lib/aceite";
import { cajaDelProducto, enteroNoNegativo } from "@/lib/cajas";
import { aLaMonedaDeLaCuenta, convertirMontos, leerCotizacion, monedaEscrita } from "@/lib/moneda";
import type { AuditAction } from "@prisma/client";
import { proximoNumeroDeCaja } from "@/lib/caja";
import { proximoNumeroDeDevolucion } from "@/lib/devoluciones";
import { reimputarEntidades } from "@/lib/imputacion";

const NON_FACTURA_TYPES: DocumentType[] = ["NOTA_CREDITO", "NOTA_DEBITO", "AJUSTE"];

const esNota = (type: DocumentType) => type === "NOTA_CREDITO" || type === "NOTA_DEBITO";

/** Un ajuste no es comprobante: va por monto, y el signo lo elige quien lo carga. */
function montoDeAjuste(formData: FormData) {
  const amount = parseAmount(formData.get("amount"), "monto");
  const resta = String(formData.get("ajusteEffect") || "SUMA") === "RESTA";
  return {
    taxRows: [],
    totals: {
      netAmount: amount,
      ivaRate: null,
      ivaAmount: ZERO,
      perceptionAmount: ZERO,
      retentionAmount: ZERO,
      totalAmount: resta ? amount.negated() : amount,
    },
  };
}

const MANUAL_TREASURY_CATEGORIES: TreasuryMovementCategory[] = [
  // PASE no está: sus dos patas se escriben juntas desde la pantalla de caja.
  "GASTO",
  "GASTO_BANCARIO",
  "IMPUESTO",
  "RETIRO",
  "DEPOSITO",
  "AJUSTE_ARQUEO",
  "OTRO",
];

/** El rubro de un movimiento de caja cargado como gasto: es lo que lo hace contar en el mes. */
function parseRubroDeCaja(
  value: FormDataEntryValue | null,
  category: TreasuryMovementCategory | null | undefined
): ExpenseCategory | null {
  if (category !== "GASTO") return null;
  const raw = String(value || "");
  return raw in EXPENSE_CATEGORY_LABELS ? (raw as ExpenseCategory) : null;
}

/** undefined = el form no tiene el campo (no tocar el valor existente al editar); null = limpiar. */
function parseManualTreasuryCategory(
  value: FormDataEntryValue | null
): TreasuryMovementCategory | null | undefined {
  if (value === null) return undefined;
  const raw = String(value);
  return MANUAL_TREASURY_CATEGORIES.includes(raw as TreasuryMovementCategory)
    ? (raw as TreasuryMovementCategory)
    : null;
}

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return parseFecha(str);
}

function parseOptionalFormDate(value: FormDataEntryValue | null): Date | null {
  const str = String(value || "").trim();
  return str ? parseFecha(str) : null;
}

function parseAmount(value: FormDataEntryValue | null, field: string): Prisma.Decimal {
  const str = String(value || "").trim();
  if (!str) throw new UserError(`Falta el monto: ${field}.`);
  return parseNumeroEscrito(str, field);
}

/**
 * El monto de un pago, en la moneda de la cuenta.
 *
 * En pesos es directo. En una cuenta en dólares se cargan los pesos que salieron y la cotización,
 * y se acredita la división: es lo que el usuario hace a mano y así queda registrado con qué
 * cotización, que si no se pierde.
 */
function montoDelPago(
  formData: FormData,
  moneda: Currency
): { amount: Prisma.Decimal; exchangeRate: Prisma.Decimal | null; amountArs: Prisma.Decimal | null } {
  if (moneda === "ARS") {
    return {
      amount: parseAmount(formData.get("amount"), "monto del pago"),
      exchangeRate: null,
      amountArs: null,
    };
  }

  const enPesos = parseAmount(formData.get("amount"), "monto del pago en pesos");
  const exchangeRate = parseAmount(formData.get("exchangeRate"), "cotización");
  if (!exchangeRate.greaterThan(0)) {
    throw new UserError("La cotización tiene que ser mayor a cero.");
  }
  // Los pesos se devuelven tal como se escribieron. La división redondea a dos decimales al
  // guardarse, así que multiplicar de vuelta no vuelve al mismo número: en un pago de
  // $39.056.000 a 1522 se pierden $3,66, y esos pesos salieron de la caja igual.
  return { amount: enPesos.dividedBy(exchangeRate), exchangeRate, amountArs: enPesos };
}

/**
 * Pasa un monto de la moneda de una cuenta a la de otra. Devuelve también la cotización usada, para
 * guardarla en el pago: sin eso no se puede reconstruir de dónde salió el número.
 */
function convertirEntreCuentas(
  monto: Prisma.Decimal,
  desde: Currency,
  hacia: Currency,
  cotizacionRaw: string,
  nombreDestino: string
): { monto: Prisma.Decimal; cotizacion: Prisma.Decimal | null } {
  if (desde === hacia) return { monto, cotizacion: null };

  if (!cotizacionRaw.trim()) {
    throw new UserError(
      `La cuenta de ${nombreDestino} se lleva en ${hacia === "USD" ? "dólares" : "pesos"}: hace falta la cotización para convertir el monto.`
    );
  }
  const cotizacion = parseNumeroEscrito(cotizacionRaw, "cotización");
  if (!cotizacion.greaterThan(0)) throw new UserError("La cotización tiene que ser mayor a cero.");

  return {
    monto: hacia === "USD" ? monto.dividedBy(cotizacion) : monto.times(cotizacion),
    cotizacion,
  };
}

async function getAccountOrThrow(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { entity: true },
  });
  if (!account) throw new UserError("Cuenta inexistente.");
  return account;
}

/** Edita una nota/ajuste ya cargado — campos simples, el pendiente se recalcula solo desde
 * totalAmount (no hay nada desnormalizado que tocar). */
export async function updateDocument(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      entrega: { select: { nombre: true } },
      destinatario: { select: { nombre: true } },
      _count: { select: { lines: true } },
    },
  });
  if (!document) throw new UserError("El comprobante ya no existe.");
  if (!NON_FACTURA_TYPES.includes(document.type)) {
    throw new UserError("Este comprobante no es una nota ni un ajuste.");
  }
  // Una devolución trae mercadería: editar sólo el importe dejaría el stock diciendo otra cosa.
  if (document._count.lines > 0) {
    throw new UserError("Es una devolución: mueve stock. Borrala y cargala de nuevo con lo correcto.");
  }
  // Un pase tiene una pata en cada caja. Editar una sola dejaría a las dos cajas diciendo cosas
  // distintas sobre la misma plata, así que se borra y se vuelve a cargar.
  if (document.treasuryCategory === "PASE") {
    throw new UserError(
      "Un pase entre cajas no se edita: tiene una pata en cada caja. Borralo y cargalo de nuevo."
    );
  }

  const type = String(formData.get("type") || "") as DocumentType;
  if (!NON_FACTURA_TYPES.includes(type)) throw new UserError("Tipo de comprobante inválido.");

  // Un movimiento de caja no muestra el número —lo puso la app—, así que llega vacío y se conserva.
  const number = String(formData.get("number") || "").trim() || document.number;

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate"));

  const reason = String(formData.get("reason") || "").trim() || null;

  if (type === "AJUSTE" && !reason) {
    throw new UserError("El ajuste manual requiere un motivo.");
  }

  const account = await getAccountOrThrow(document.accountId);
  // Cómo estaba antes de pisarlo.
  const antesDelDoc = fotoDelComprobante({
    tipo: DOCUMENT_TYPE_LABELS[document.type],
    number: document.number,
    date: document.date,
    dueDate: document.dueDate,
    currency: document.currency,
    exchangeRate: document.exchangeRate,
    netAmount: document.netAmount,
    ivaAmount: document.ivaAmount,
    perceptionAmount: document.perceptionAmount,
    retentionAmount: document.retentionAmount,
    totalAmount: document.totalAmount,
    reason: document.reason,
    rubro: document.expenseCategory ? EXPENSE_CATEGORY_LABELS[document.expenseCategory] : null,
    viaje: document.entrega?.nombre ?? null,
    destinatario: document.destinatario?.nombre ?? null,
  });
  const { destinatarioId, entregaId } = await leerDestinatarioYEntrega(formData, account.entityId);
  // Los montos se guardan en la moneda de la cuenta; si se escribieron en la otra, se convierten.
  const currency: Currency = account.entity.moneda;
  const { convertir, exchangeRate } = aLaMonedaDeLaCuenta(
    monedaEscrita(formData.get("currency"), currency),
    currency,
    leerCotizacion(formData.get("exchangeRate"))
  );
  const escritos = esNota(type) ? impuestosDeNota(formData, account.circuit) : montoDeAjuste(formData);
  const taxRows = escritos.taxRows.map((r) => convertirMontos(r, convertir));
  const totals = convertirMontos(escritos.totals, convertir);

  const treasuryCategory = parseManualTreasuryCategory(formData.get("treasuryCategory"));
  const expenseCategory = parseRubroDeCaja(formData.get("expenseCategory"), treasuryCategory);

  await prisma.$transaction(async (tx) => {
    // El desglose se reescribe entero: es más corto que conciliar fila por fila, y pasar de nota a
    // ajuste tiene que dejar el comprobante sin tributos.
    await tx.documentTax.deleteMany({ where: { documentId } });

    await tx.document.update({
      where: { id: documentId },
      data: {
        type,
        number,
        date,
        dueDate,
        currency,
        exchangeRate,
        ...totals,
        reason,
        destinatarioId,
        entregaId,
        ...(treasuryCategory !== undefined ? { treasuryCategory, expenseCategory } : {}),
      },
    });

    if (taxRows.length > 0) {
      await tx.documentTax.createMany({ data: taxRows.map((row) => ({ ...row, documentId })) });
    }

    // Si es un movimiento a mano de una caja, que no la deje en rojo.
    await asegurarSinNegativos(tx, { cuentas: [document.accountId] });
  });

  const [viajeNuevo, destinatarioNuevo] = await Promise.all([
    entregaId
      ? prisma.entrega.findUnique({ where: { id: entregaId }, select: { nombre: true } })
      : null,
    destinatarioId
      ? prisma.destinatario.findUnique({ where: { id: destinatarioId }, select: { nombre: true } })
      : null,
  ]);

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Movimiento de cuenta",
    entityId: documentId,
    summary: `#${number} — ${account.entity.name} — ${formatMoney(totals.totalAmount, currency)}`,
    cambios: diffDeCampos(
      antesDelDoc,
      fotoDelComprobante({
        tipo: DOCUMENT_TYPE_LABELS[type],
        number,
        date,
        dueDate,
        currency,
        exchangeRate,
        netAmount: totals.netAmount,
        ivaAmount: totals.ivaAmount,
        perceptionAmount: totals.perceptionAmount,
        retentionAmount: totals.retentionAmount,
        totalAmount: totals.totalAmount,
        reason,
        rubro: expenseCategory ? EXPENSE_CATEGORY_LABELS[expenseCategory] : null,
        viaje: viajeNuevo?.nombre ?? null,
        destinatario: destinatarioNuevo?.nombre ?? null,
      }),
      CAMPOS_DEL_COMPROBANTE
    ),
  });

  await reimputarEntidades(account.entityId);
  revalidatePath(`/cuentas-corrientes/${account.entity.slug}`);
}

export async function deleteDocument(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      account: { include: { entity: true } },
      contraparteDe: { select: { id: true } },
      entrega: { select: { nombre: true } },
      destinatario: { select: { nombre: true } },
    },
  });
  if (!document) throw new UserError("El comprobante ya no existe.");
  if (!NON_FACTURA_TYPES.includes(document.type)) {
    throw new UserError("Este comprobante no es una nota ni un ajuste.");
  }

  await prisma.$transaction(async (tx) => {
    // La otra pata de un pase entre cajas. La FK se lleva sola a la que apunta a ésta, pero no al
    // revés, y media plata en el aire es peor que no poder borrarla.
    const otraPata = document.contraparteId ?? document.contraparteDe?.id;
    if (otraPata) await tx.document.deleteMany({ where: { id: otraPata } });
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    // Una venta de insumo cuelga su movimiento de stock de este documento: son un solo hecho, así
    // que borrar el comprobante devuelve el stock. Sin esto la FK bloquea el borrado con un error
    // de Prisma en crudo.
    await tx.itemMovement.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });

    // Borrar una entrada de plata —o la pata que entraba de un pase— puede dejar una caja en rojo.
    const cuentaDeLaOtraPata = otraPata
      ? (await prisma.document.findUnique({ where: { id: otraPata }, select: { accountId: true } }))?.accountId
      : null;
    await asegurarSinNegativos(tx, { cuentas: [document.accountId, cuentaDeLaOtraPata ?? null] });

    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Movimiento de cuenta",
      entityId: documentId,
      summary: `#${document.number} — ${document.account.entity.name} — ${formatMoney(document.totalAmount, document.currency)}`,
      cambios: diffDeCampos(fotoDelDocumento(document), null, CAMPOS_DEL_COMPROBANTE),
    });
  });

  await reimputarEntidades(document.account.entityId);
  revalidatePath(`/cuentas-corrientes/${document.account.entity.slug}`);
}

/**
 * Variante de createDocument para el botón "+ Movimiento" de la ficha individual: ahí no se
 * conoce el accountId de antemano (se elige la cuenta en el mismo formulario), así que se
 * resuelve acá — mismo patrón que createPaymentForEntity.
 */
export async function createDocumentForEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new UserError("Falta el cliente o proveedor.");

  const entidad = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entidad) throw new UserError("No se encontró la entidad.");
  // En una caja el circuito no se elige: es el suyo. Que el formulario ya no lo muestre no alcanza,
  // porque uno viejo abierto en otra pestaña lo seguiría mandando.
  const circuit =
    entidad.type === "TESORERIA"
      ? circuitoDeTesoreria(entidad.name)
      : String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new UserError("Cuenta inválida.");

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
    include: { entity: true },
  });
  if (!account) throw new UserError("No se encontró la cuenta de esta entidad.");

  const type = String(formData.get("type") || "") as DocumentType;
  if (!NON_FACTURA_TYPES.includes(type)) throw new UserError("Tipo de comprobante inválido.");

  // En una caja el número lo pone la app (CAJA-00012): nadie da comprobante por un ajuste de arqueo,
  // y tipearlo a mano dejaba numeraciones sueltas como "01-01".
  const numeroEscrito = String(formData.get("number") || "").trim();
  if (!numeroEscrito && entidad.type !== "TESORERIA") throw new UserError("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate"));

  const reason = String(formData.get("reason") || "").trim() || null;

  if (type === "AJUSTE" && !reason) {
    throw new UserError("El ajuste manual requiere un motivo.");
  }

  // Los montos se guardan en la moneda de la cuenta; si se escribieron en la otra, se convierten.
  const currency: Currency = account.entity.moneda;
  const { convertir, exchangeRate } = aLaMonedaDeLaCuenta(
    monedaEscrita(formData.get("currency"), currency),
    currency,
    leerCotizacion(formData.get("exchangeRate"))
  );
  // Una nota es un comprobante y en Blanco lleva IVA discriminado; un ajuste es una corrección de
  // saldo y va por monto, con el signo que elija quien lo carga.
  const escritos = esNota(type) ? impuestosDeNota(formData, circuit) : montoDeAjuste(formData);
  const taxRows = escritos.taxRows.map((r) => convertirMontos(r, convertir));
  const totals = convertirMontos(escritos.totals, convertir);

  const treasuryCategory = parseManualTreasuryCategory(formData.get("treasuryCategory")) || null;
  const expenseCategory = parseRubroDeCaja(formData.get("expenseCategory"), treasuryCategory);
  // Es lo que deja colgar del viaje la nota de crédito del 5%: sin esto bajaría el saldo general
  // y no el del camión, que es donde se mira.
  const { destinatarioId, entregaId } = await leerDestinatarioYEntrega(formData, entityId);

  const document = await prisma.$transaction(async (tx) => {
    const number = numeroEscrito || (await proximoNumeroDeCaja(tx, account.id));
    const creado = await tx.document.create({
      data: {
        accountId: account.id,
        type,
        number,
        date,
        dueDate,
        currency,
        exchangeRate,
        ...totals,
        reason,
        destinatarioId,
        entregaId,
        treasuryCategory,
        expenseCategory,
        createdById: user.id,
      },
    });

    if (taxRows.length > 0) {
      await tx.documentTax.createMany({ data: taxRows.map((row) => ({ ...row, documentId: creado.id })) });
    }

    await asegurarSinNegativos(tx, { cuentas: [account.id] });

    return creado;
  });

  // Los nombres, para que el detalle de Actividad diga "Camión 12" y no un cuid.
  const [viajeAlta, destinatarioAlta] = await Promise.all([
    entregaId ? prisma.entrega.findUnique({ where: { id: entregaId }, select: { nombre: true } }) : null,
    destinatarioId
      ? prisma.destinatario.findUnique({ where: { id: destinatarioId }, select: { nombre: true } })
      : null,
  ]);

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Movimiento de cuenta",
    entityId: document.id,
    summary: `#${document.number} — ${account.entity.name} — ${formatMoney(totals.totalAmount, currency)}`,
    cambios: diffDeCampos(
      null,
      fotoDelComprobante({
        tipo: DOCUMENT_TYPE_LABELS[type],
        number: document.number,
        date,
        dueDate,
        currency,
        exchangeRate,
        netAmount: totals.netAmount,
        ivaAmount: totals.ivaAmount,
        perceptionAmount: totals.perceptionAmount,
        retentionAmount: totals.retentionAmount,
        totalAmount: totals.totalAmount,
        reason,
        rubro: expenseCategory ? EXPENSE_CATEGORY_LABELS[expenseCategory] : null,
        viaje: viajeAlta?.nombre ?? null,
        destinatario: destinatarioAlta?.nombre ?? null,
      }),
      CAMPOS_DEL_COMPROBANTE
    ),
  });

  await reimputarEntidades(account.entityId);
  revalidatePath(`/cuentas-corrientes/${account.entity.slug}`);
}

/**
 * Los campos de un pago que vale la pena ver en el detalle de Actividad, con el nombre que les
 * pone la pantalla. Lo que no está acá no se compara: un id interno o un `updatedAt` no le dicen
 * nada a nadie, y el detalle sirve justamente porque no tiene ruido.
 */
/** Lo que se mira de un comprobante: la nota, el ajuste, el gasto, la factura. */
const CAMPOS_DEL_COMPROBANTE = {
  tipo: "Tipo",
  number: "N\u00famero",
  date: "Fecha",
  dueDate: "Vencimiento",
  currency: "Moneda",
  exchangeRate: "Cotizaci\u00f3n",
  netAmount: "Neto",
  ivaRate: "Al\u00edcuota IVA",
  ivaAmount: "IVA",
  perceptionAmount: "Percepciones",
  retentionAmount: "Retenci\u00f3n",
  totalAmount: "Total",
  reason: "Detalle",
  rubro: "Rubro",
  viaje: "Viaje",
  destinatario: "A nombre de",
} as const;

/**
 * La misma foto, pero armada desde una fila de la base. Es lo que necesitan los borrados y las
 * ediciones: ahí el "antes" ya está guardado y lo único que falta es ponerle los nombres.
 */
function fotoDelDocumento(d: {
  type: DocumentType;
  number: string;
  date: Date;
  dueDate: Date | null;
  currency: string;
  exchangeRate: Prisma.Decimal | null;
  netAmount: Prisma.Decimal;
  ivaRate: Prisma.Decimal | null;
  ivaAmount: Prisma.Decimal | null;
  perceptionAmount: Prisma.Decimal | null;
  retentionAmount: Prisma.Decimal | null;
  totalAmount: Prisma.Decimal;
  reason: string | null;
  expenseCategory: ExpenseCategory | null;
  entrega?: { nombre: string } | null;
  destinatario?: { nombre: string } | null;
}) {
  return fotoDelComprobante({
    tipo: DOCUMENT_TYPE_LABELS[d.type],
    number: d.number,
    date: d.date,
    dueDate: d.dueDate,
    currency: d.currency,
    exchangeRate: d.exchangeRate,
    netAmount: d.netAmount,
    ivaRate: d.ivaRate,
    ivaAmount: d.ivaAmount,
    perceptionAmount: d.perceptionAmount,
    retentionAmount: d.retentionAmount,
    totalAmount: d.totalAmount,
    reason: d.reason,
    rubro: d.expenseCategory ? EXPENSE_CATEGORY_LABELS[d.expenseCategory] : null,
    viaje: d.entrega?.nombre ?? null,
    destinatario: d.destinatario?.nombre ?? null,
  });
}

function fotoDelComprobante(d: {
  tipo: string;
  number: string;
  date: Date;
  dueDate: Date | null;
  currency: string;
  exchangeRate: Prisma.Decimal | null;
  netAmount: Prisma.Decimal;
  /** Sólo la factura y la compra la guardan; una nota lleva su desglose en DocumentTax. */
  ivaRate?: Prisma.Decimal | null;
  ivaAmount: Prisma.Decimal | null;
  perceptionAmount: Prisma.Decimal | null;
  retentionAmount: Prisma.Decimal | null;
  totalAmount: Prisma.Decimal;
  reason: string | null;
  rubro: string | null;
  viaje: string | null;
  destinatario: string | null;
}) {
  return { ...d };
}

const CAMPOS_DEL_PAGO = {
  date: "Fecha",
  amount: "Monto",
  currency: "Moneda",
  amountArs: "Monto en pesos",
  exchangeRate: "Cotizaci\u00f3n",
  method: "M\u00e9todo",
  retentionKind: "Tipo de retenci\u00f3n",
  reference: "Descripci\u00f3n",
  numeroOperacion: "N\u00b0 de operaci\u00f3n",
  circuito: "Cuenta",
  viaje: "Viaje",
} as const;

/** Un pago en la forma que compara `diffDeCampos`. */
function fotoDelPago(p: {
  date: Date;
  amount: Prisma.Decimal;
  currency: string;
  amountArs: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
  method: string;
  retentionKind: string | null;
  reference: string | null;
  numeroOperacion: string | null;
  circuito: string;
  viaje: string | null;
}) {
  return { ...p };
}

/**
 * El número que el banco le da a una transferencia. Sólo tiene sentido en una transferencia: con
 * otro medio se descarta, para que no quede colgado un número de un medio anterior.
 */
function leerNumeroOperacion(formData: FormData, method: PaymentMethod) {
  if (method !== "TRANSFERENCIA") return null;
  return String(formData.get("numeroOperacion") || "").trim() || null;
}

/**
 * El destinatario y el viaje que trae el formulario, validados contra la entidad.
 *
 * Se comprueba que sean SUYOS y no solo que existan: si no, un formulario viejo o un POST armado
 * a mano podría colgar el remito de Gonzalo del camión de otro cliente, y ahí el saldo de los dos
 * viajes queda mal sin que nada avise.
 */
async function leerDestinatarioYEntrega(formData: FormData, entityId: string) {
  const destinatarioId = String(formData.get("destinatarioId") || "") || null;
  const entregaId = String(formData.get("entregaId") || "") || null;

  if (destinatarioId) {
    const destinatario = await prisma.destinatario.findUnique({ where: { id: destinatarioId } });
    if (!destinatario || destinatario.entityId !== entityId) {
      throw new UserError("El destinatario elegido no es de esta cuenta.");
    }
  }
  if (entregaId) {
    const entrega = await prisma.entrega.findUnique({ where: { id: entregaId } });
    if (!entrega || entrega.entityId !== entityId) {
      throw new UserError("El viaje elegido no es de esta cuenta.");
    }
  }

  return { destinatarioId, entregaId };
}

/**
 * Contra qué comprobantes se imputa un pago.
 *
 * Con viaje, sólo contra los de ese viaje. Sin viaje hay dos casos distintos y conviene no
 * confundirlos: si el cliente **no trabaja por viajes**, se imputa contra toda la cuenta como
 * siempre; si **sí los usa**, un pago sin viaje sólo cancela lo que tampoco tiene viaje, así que
 * no se come lo del camión de nadie. Esto último es lo que hace que agregar viajes no cambie el
 * comportamiento para los 17 clientes que no los van a usar.
 */
async function alcanceDeImputacion(entityId: string, entregaId: string | null) {
  if (entregaId) return entregaId;
  const tieneViajes = await prisma.entrega.count({ where: { entityId } });
  return tieneViajes > 0 ? null : undefined;
}

/** Núcleo compartido por createRemito y updateRemito (que borra y vuelve a llamar a este núcleo)
 * — así una edición queda como un solo UPDATE en el log, no un DELETE + CREATE. */
/**
 * Lo que se entregó o se compró, escrito en un solo campo del detalle: un renglón por línea.
 *
 * Va junto y no campo por campo porque las líneas no tienen identidad estable —se borran y se
 * vuelven a escribir en cada edición—, así que "la línea 2 cambió" no significaría nada. Como
 * texto de varios renglones se lee de un vistazo qué entró y qué salió.
 */
function renglones(
  lineas: { nombre: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null }[]
): string | null {
  if (lineas.length === 0) return null;
  return lineas
    .map((l) => {
      const cantidad = formatNumeroExacto(l.quantity);
      const precio = l.unitPrice && !l.unitPrice.isZero() ? ` a $${formatNumeroExacto(l.unitPrice)}` : "";
      return `${l.nombre} \u00d7 ${cantidad}${precio}`;
    })
    .join("\n");
}

/** La foto de un comprobante con líneas, armada desde la base: lo que necesitan editar y borrar. */
function fotoDeComprobanteConLineas(d: {
  number: string;
  date: Date;
  currency: string;
  exchangeRate: Prisma.Decimal | null;
  totalAmount: Prisma.Decimal;
  reason: string | null;
  entrega?: { nombre: string } | null;
  destinatario?: { nombre: string } | null;
  lines?: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null; product: { name: string } }[];
  purchaseLines?: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null; item: { name: string } }[];
}) {
  return {
    number: d.number,
    date: d.date,
    currency: d.currency,
    exchangeRate: d.exchangeRate,
    totalAmount: d.totalAmount,
    reason: d.reason,
    viaje: d.entrega?.nombre ?? null,
    destinatario: d.destinatario?.nombre ?? null,
    renglones: renglones([
      ...(d.lines ?? []).map((l) => ({ nombre: l.product.name, quantity: l.quantity, unitPrice: l.unitPrice })),
      ...(d.purchaseLines ?? []).map((l) => ({ nombre: l.item.name, quantity: l.quantity, unitPrice: l.unitPrice })),
    ]),
  };
}

/** Lo que se mira de una entrega o de una compra: el encabezado más los renglones. */
const CAMPOS_CON_RENGLONES = {
  number: "N\u00famero",
  date: "Fecha",
  currency: "Moneda",
  exchangeRate: "Cotizaci\u00f3n",
  totalAmount: "Total",
  reason: "Detalle",
  viaje: "Viaje",
  destinatario: "A nombre de",
  renglones: "L\u00edneas",
} as const;

/**
 * Las líneas de un remito o de una devolución: producto, pallets, cajas sueltas y precio.
 *
 * El precio por botella llega tal como se escribió y la cuenta del pallet se hace acá: el navegador
 * la hacía con `Number()`, que no entiende la coma, y un "1350,50" llegaba como cero. Con la
 * cotización cargada, el precio está en la otra moneda que la de la cuenta.
 *
 * `quantity` es el equivalente en pallets (2 pallets + 42 cajas de 84 = 2,5), que es con lo que se
 * suman los reportes. El stock se mueve con `pallets` y `cajas`, que son lo que se entregó de verdad.
 * Un formulario viejo, sin el campo de cajas, sigue mandando pallets con decimales: ahí `pallets` y
 * `cajas` quedan vacíos y se mueve `quantity`, como antes.
 */
async function leerLineasDeProducto(formData: FormData, currency: Currency, exchangeRate: Prisma.Decimal | null) {
  const productIds = formData.getAll("lineProductId").map(String);
  const quantities = formData.getAll("lineQuantity").map(String);
  const cajasPorLinea = formData.getAll("lineCajas").map(String);
  // Sólo las devoluciones las mandan: un cliente puede devolver botellas sin caja.
  const botellasPorLinea = formData.getAll("lineBotellas").map(String);
  const unitPrices = formData.getAll("lineUnitPrice").map(String);
  const circuits = formData.getAll("lineCircuit").map(String);
  const preciosBotella = formData.getAll("linePrecioBotella").map(String);
  const preciosBotellaUsd = formData.getAll("linePrecioBotellaUsd").map(String);
  for (const [nombre, arr] of [
    ["precio por botella", preciosBotella],
    ["precio por botella en U$S", preciosBotellaUsd],
    ["cajas sueltas", cajasPorLinea],
    ["botellas sueltas", botellasPorLinea],
  ] as const) {
    if (arr.length > 0 && arr.length !== productIds.length) {
      throw new UserError(`El formulario llegó incompleto (${nombre}) — recargá la página y volvé a cargarlo.`);
    }
  }
  const conCajas = cajasPorLinea.length > 0;

  const productos = new Map(
    (await prisma.product.findMany({ where: { id: { in: productIds.filter(Boolean) } } })).map((p) => [p.id, p])
  );

  const lines = productIds.map((productId, i) => {
    const circuit = circuits[i] as "BLANCO" | "NEGRO";
    const p = productos.get(productId);
    const nombre = p ? `${p.name} ${p.oilType} ${p.presentation}` : "Uno de los productos";
    const bpp = p?.boxesPerPallet ?? null;
    const upb = p?.unitsPerBox ?? null;

    // ---- cantidades
    let pallets: number | null = null;
    let cajas: number | null = null;
    let botellas = 0;
    let quantity: Prisma.Decimal;
    if (conCajas) {
      // Opcionales: la fila vacía que queda al tocar "+ Agregar línea" se descarta abajo. Un número
      // mal escrito sigue dando error, y medio pallet o media caja no existen.
      const p0 = enteroNoNegativo(parseNumeroOpcional(quantities[i] ?? "", "pallets"), `${nombre}, pallets`);
      const c0 = enteroNoNegativo(parseNumeroOpcional(cajasPorLinea[i] ?? "", "cajas"), `${nombre}, cajas`);
      if (c0 > 0 && !bpp) {
        throw new UserError(`${nombre} no tiene cargadas las cajas por pallet, así que no se pueden entregar cajas sueltas.`);
      }
      const b0 = enteroNoNegativo(parseNumeroOpcional(botellasPorLinea[i] ?? "", "botellas"), `${nombre}, botellas`);
      if (b0 > 0 && (!bpp || !upb)) {
        throw new UserError(`${nombre} no tiene cargadas las cajas por pallet y las botellas por caja, así que no se pueden contar botellas sueltas.`);
      }
      pallets = p0;
      cajas = c0;
      botellas = b0;
      quantity = toDecimal(p0)
        .plus(c0 > 0 ? toDecimal(c0).dividedBy(bpp!) : 0)
        .plus(b0 > 0 ? toDecimal(b0).dividedBy(bpp! * upb!) : 0)
        .toDecimalPlaces(3);
    } else {
      quantity = parseNumeroOpcional(quantities[i] ?? "", "cantidad");
    }

    // ---- precio
    const usdRaw = (preciosBotellaUsd[i] ?? "").trim();
    const botellaRaw = (preciosBotella[i] ?? "").trim();
    let porBotella: Prisma.Decimal | null = null;
    let precioBotellaUsd: Prisma.Decimal | null = null;
    if (usdRaw) {
      const usd = parseNumeroEscrito(usdRaw, "precio por botella en U$S");
      // En una cuenta en dólares no hay nada que convertir.
      if (currency !== "USD" && !exchangeRate) {
        throw new UserError("El precio está en dólares: cargá la cotización para pasarlo a pesos.");
      }
      porBotella = currency === "USD" ? usd : usd.times(exchangeRate!);
      precioBotellaUsd = usd;
    } else if (botellaRaw) {
      // En una cuenta en dólares, con la cotización cargada el precio se escribió en pesos.
      const escrito = parseNumeroEscrito(botellaRaw, "precio por botella");
      porBotella = currency === "USD" && exchangeRate ? escrito.dividedBy(exchangeRate) : escrito;
    }

    if (!porBotella) {
      // Un formulario viejo, que todavía manda el precio del pallet ya calculado.
      const unitPrice = parseNumeroOpcional(unitPrices[i] ?? "", "precio unitario");
      return {
        indice: i,
        productId,
        circuit,
        pallets,
        cajas,
        botellas,
        quantity,
        unitPrice,
        precioBotellaUsd,
        subtotal: quantity.times(unitPrice).toDecimalPlaces(2),
      };
    }
    if (!bpp || !upb) {
      throw new UserError(
        `${nombre} no tiene cargadas cajas por pallet y botellas por caja, así que no se puede pasar el precio por botella a precio del pallet.`
      );
    }
    const unitPrice = porBotella.times(bpp * upb).toDecimalPlaces(2);
    // El subtotal sale de las botellas, no de `quantity` × precio: el equivalente en pallets de unas
    // cajas sueltas (48 de 105 = 0,457…) se redondea, y correría el importe.
    const totalBotellas = conCajas ? (pallets! * bpp + cajas!) * upb + botellas : quantity.times(bpp * upb);
    return {
      indice: i,
      productId,
      circuit,
      pallets,
      cajas,
      botellas,
      quantity,
      unitPrice,
      precioBotellaUsd,
      subtotal: porBotella.times(totalBotellas).toDecimalPlaces(2),
    };
  })
    // Sin exigir precio > 0: una línea sin cargo es legítima (una muestra) y descartarla en
    // silencio es peor que cobrarla mal. Lo que distingue una línea cargada de una vacía es la
    // cantidad.
    .filter((l) => l.productId && l.quantity.greaterThan(0));

  if (lines.some((l) => l.circuit !== "BLANCO" && l.circuit !== "NEGRO")) {
    throw new UserError("Circuito inválido en alguna línea.");
  }
  return lines;
}

/**
 * Lo que una línea de remito (o de devolución) le hace al stock, colgado de su línea: si se borra o
 * se edita el remito, se va con ella.
 *
 * **Las cajas sueltas que falten se sacan de desarmar pallets de ese formato.** Es lo que pasa en el
 * depósito: para entregar 48 cajas se desarma un pallet de 84, se cargan 48 y quedan 36 sueltas. El
 * desarmado no puede ser un trámite aparte —no se cargaría nunca—, así que lo hace la entrega sola,
 * y el formulario avisa antes de guardar cuántos pallets va a desarmar. Si no hay pallets, no se
 * desarma nada y las cajas quedan en negativo hasta que se cargue la producción del día.
 */
async function moverStockDeLinea(
  tx: Prisma.TransactionClient,
  params: {
    line: { productId: string; pallets: number | null; cajas: number | null; quantity: Prisma.Decimal };
    documentLineId: string;
    date: Date;
    motivo: string;
    /** Una entrega saca del stock; una devolución lo vuelve a poner. */
    tipo: "ENTREGA" | "DEVOLUCION";
    userId: string;
  }
): Promise<void> {
  const { line, documentLineId, date, motivo, tipo, userId } = params;
  const signo = tipo === "ENTREGA" ? -1 : 1;
  const base = { date, documentLineId, createdById: userId };

  // Una línea de antes de las cajas sueltas: pallets con decimales, como se movía siempre.
  if (line.pallets === null || line.cajas === null) {
    await tx.productMovement.create({
      data: { ...base, productId: line.productId, quantity: line.quantity.times(signo), type: tipo, reason: motivo },
    });
    return;
  }

  if (line.pallets > 0) {
    await tx.productMovement.create({
      data: { ...base, productId: line.productId, quantity: signo * line.pallets, type: tipo, reason: motivo },
    });
  }
  if (line.cajas === 0) return;

  const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
  const cajaId = await cajaDelProducto(tx, product);

  if (tipo === "ENTREGA") {
    const sueltas = (await tx.cajaMovement.aggregate({ where: { cajaId }, _sum: { quantity: true } }))._sum.quantity ?? 0;
    const faltan = line.cajas - Math.max(sueltas, 0);
    // Se desarman sólo los pallets que hay. Si tampoco hay pallets, las cajas se hicieron hoy y la
    // producción todavía no se cargó: quedan en negativo hasta que se cargue, en vez de inventar un
    // desarmado de un pallet que no existe.
    const palletsQueHay = (await tx.productMovement.aggregate({ where: { productId: product.id }, _sum: { quantity: true } }))
      ._sum.quantity;
    const disponibles = Math.max(Math.floor(palletsQueHay?.toNumber() ?? 0), 0);
    if (faltan > 0 && disponibles > 0) {
      const bpp = product.boxesPerPallet!;
      const aDesarmar = Math.min(Math.ceil(faltan / bpp), disponibles);
      const motivoDesarmado = `Desarmado para ${motivo.charAt(0).toLowerCase()}${motivo.slice(1)}`;
      await tx.productMovement.create({
        data: { ...base, productId: product.id, quantity: -aDesarmar, type: "DESARMADO", reason: motivoDesarmado },
      });
      await tx.cajaMovement.create({
        data: { ...base, cajaId, quantity: aDesarmar * bpp, type: "DESARMADO", reason: motivoDesarmado },
      });
    }
  }

  await tx.cajaMovement.create({
    data: { ...base, cajaId, quantity: signo * line.cajas, type: tipo, reason: motivo },
  });
}

type LineaDeProducto = Awaited<ReturnType<typeof leerLineasDeProducto>>[number];
type EstadoDeLinea = {
  estado: EstadoDevolucion;
  cajasRotas: number | null;
  botellasSanas: number | null;
  palletsRearmados: boolean | null;
};
type LineaDevuelta = LineaDeProducto & { estado: EstadoDeLinea; bpp: number; upb: number };

/**
 * En qué estado volvió cada línea. Los campos se aparean por posición con las líneas del
 * formulario —`indice`—, porque las vacías se descartan al leerlas.
 */
async function leerEstadosDeDevolucion(formData: FormData, lines: LineaDeProducto[]): Promise<LineaDevuelta[]> {
  const estados = formData.getAll("lineEstado").map(String);
  const cajasRotas = formData.getAll("lineCajasRotas").map(String);
  const botellasSanas = formData.getAll("lineBotellasSanas").map(String);
  const destinos = formData.getAll("linePalletsDestino").map(String);
  const productos = new Map(
    (await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } })).map((p) => [p.id, p])
  );

  return lines.map((l) => {
    const p = productos.get(l.productId)!;
    const nombre = `${p.name} ${p.oilType} ${p.presentation}`;
    if (l.pallets === null || l.cajas === null) {
      throw new UserError("El formulario llegó incompleto — recargá la página y volvé a cargar la devolución.");
    }
    const bpp = p.boxesPerPallet ?? 0;
    const upb = p.unitsPerBox ?? 0;
    const estado = (estados[l.indice] || "SANO") as EstadoDevolucion;
    if (!["SANO", "CON_ROTURAS", "NO_SIRVE"].includes(estado)) throw new UserError(`${nombre}: estado inválido.`);
    if (estado !== "CON_ROTURAS") {
      return { ...l, bpp, upb, estado: { estado, cajasRotas: null, botellasSanas: null, palletsRearmados: null } };
    }

    if (!bpp || !upb) {
      throw new UserError(`${nombre} no tiene cargadas las cajas por pallet y las botellas por caja: no se pueden contar las roturas.`);
    }
    const rotas = enteroNoNegativo(parseNumeroOpcional(cajasRotas[l.indice] ?? "", "cajas rotas"), `${nombre}, cajas rotas`);
    const sanas = enteroNoNegativo(parseNumeroOpcional(botellasSanas[l.indice] ?? "", "botellas sanas"), `${nombre}, botellas sanas`);
    const cajasQueVinieron = l.pallets * bpp + l.cajas;
    if (rotas === 0 && sanas === l.botellas) {
      throw new UserError(`${nombre}: si vino con roturas, cargá cuántas cajas no sirven o cuántas botellas quedaron sanas.`);
    }
    if (rotas > cajasQueVinieron) {
      throw new UserError(`${nombre}: hay ${rotas} cajas rotas pero volvieron ${cajasQueVinieron} cajas.`);
    }
    // Las sanas salen de las botellas que vinieron sueltas y de las cajas rotas que se abrieron.
    if (sanas > rotas * upb + l.botellas) {
      throw new UserError(
        `${nombre}: ${sanas} botellas sanas son más de las que hay entre las cajas rotas y las botellas sueltas (${rotas * upb + l.botellas}).`
      );
    }
    const destino = destinos[l.indice];
    if (l.pallets > 0 && destino !== "REARMADO" && destino !== "DESARMADO") {
      throw new UserError(`${nombre}: elegí si los pallets se volvieron a armar o se desarmaron.`);
    }
    return {
      ...l,
      bpp,
      upb,
      estado: {
        estado,
        cajasRotas: rotas,
        botellasSanas: sanas,
        palletsRearmados: l.pallets > 0 ? destino === "REARMADO" : null,
      },
    };
  });
}

/** Lo devuelto en palabras, para Actividad: "1 pallet + 3 cajas, con roturas: 2 cajas rotas…". */
function describirDevuelto(l: LineaDevuelta) {
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const partes = [
    l.pallets ? plural(l.pallets, "pallet", "pallets") : null,
    l.cajas ? plural(l.cajas, "caja", "cajas") : null,
    l.botellas ? plural(l.botellas, "botella", "botellas") : null,
  ].filter(Boolean);
  const { estado, cajasRotas, botellasSanas, palletsRearmados } = l.estado;
  let detalle = ESTADO_DEVOLUCION_LABELS[estado].toLowerCase();
  if (estado === "CON_ROTURAS") {
    detalle += `: ${plural(cajasRotas ?? 0, "caja rota", "cajas rotas")}, ${plural(botellasSanas ?? 0, "botella sana", "botellas sanas")} sueltas`;
    if (palletsRearmados !== null) detalle += palletsRearmados ? ", pallets rearmados con cajas del stock" : ", pallets desarmados";
  }
  return `${partes.join(" + ")} (${detalle})`;
}

/**
 * Lo que una línea de devolución le hace al stock, según cómo volvió. Todo cuelga de la línea:
 * borrar la nota de crédito lo deshace entero.
 *
 * - **Sano**: los pallets, las cajas y las botellas vuelven tal como vinieron.
 * - **Con roturas**: vuelve lo que vino y las cajas rotas se dan de baja como merma. Si había
 *   pallets, o se rearmaron —el pallet vuelve completo y las cajas que reemplazaron a las rotas
 *   salen de las sueltas— o se desarmaron y todo queda en cajas sueltas. Las botellas sanas quedan
 *   sueltas, para juntarlas en cajas.
 * - **No sirve nada**: no entra nada. La nota de crédito se hace igual: eso lo decide el precio.
 */
async function moverStockDeDevolucion(
  tx: Prisma.TransactionClient,
  params: { line: LineaDevuelta; documentLineId: string; date: Date; motivo: string; userId: string }
) {
  const { line, documentLineId, date, motivo, userId } = params;
  const { estado, cajasRotas, botellasSanas, palletsRearmados } = line.estado;
  if (estado === "NO_SIRVE") return;

  const pallets = line.pallets ?? 0;
  const cajas = line.cajas ?? 0;
  const base = { date, documentLineId, createdById: userId };
  if (pallets > 0) {
    await tx.productMovement.create({
      data: { ...base, productId: line.productId, quantity: pallets, type: "DEVOLUCION", reason: motivo },
    });
  }

  const botellas = estado === "SANO" ? line.botellas : (botellasSanas ?? 0);
  const rotas = estado === "CON_ROTURAS" ? (cajasRotas ?? 0) : 0;
  const desarmar = estado === "CON_ROTURAS" && pallets > 0 && palletsRearmados === false;
  if (cajas === 0 && botellas === 0 && rotas === 0 && !desarmar) return;

  const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
  const cajaId = await cajaDelProducto(tx, product);

  if (desarmar) {
    const motivoDesarmado = `Desarmado de lo devuelto con roturas — ${motivo}`;
    await tx.productMovement.create({
      data: { ...base, productId: line.productId, quantity: -pallets, type: "DESARMADO", reason: motivoDesarmado },
    });
    await tx.cajaMovement.create({
      data: { ...base, cajaId, quantity: pallets * line.bpp, type: "DESARMADO", reason: motivoDesarmado },
    });
  }
  if (cajas > 0 || botellas > 0) {
    await tx.cajaMovement.create({ data: { ...base, cajaId, quantity: cajas, botellas, type: "DEVOLUCION", reason: motivo } });
  }
  if (rotas > 0) {
    await tx.cajaMovement.create({
      data: {
        ...base,
        cajaId,
        quantity: -rotas,
        type: "MERMA",
        reason: `Cajas rotas — ${motivo}${pallets > 0 && palletsRearmados ? " (reemplazadas al rearmar el pallet)" : ""}`,
      },
    });
  }
}

/**
 * Un cliente devuelve mercadería: vuelve al stock y se le hace una nota de crédito por lo que vale.
 *
 * Es el remito al revés, con las mismas líneas: producto, pallets, cajas sueltas y precio por
 * botella. Las líneas cuelgan de la nota de crédito, así que borrarla saca la mercadería del stock
 * otra vez. Si lo devuelto tiene líneas en Blanco y en Negro, sale una nota por cada cuenta, igual
 * que un remito se parte en dos.
 */
export async function crearDevolucion(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) throw new UserError("El cliente ya no existe.");

  const date = parseFormDate(formData.get("date"));
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) throw new UserError("Escribí por qué se devolvió: es lo que va a explicar la nota de crédito.");
  // El viaje al que vuelve: el crédito baja el saldo de ese camión y no el del resto de la cuenta.
  const { destinatarioId, entregaId } = await leerDestinatarioYEntrega(formData, entityId);

  const currency: Currency = entity.moneda;
  const exchangeRate = leerCotizacion(formData.get("exchangeRate"));
  const lineasLeidas = await leerLineasDeProducto(formData, currency, exchangeRate);
  if (lineasLeidas.length === 0) throw new UserError("Cargá al menos una línea con lo que se devolvió.");
  const lines = await leerEstadosDeDevolucion(formData, lineasLeidas);

  const accounts = await prisma.account.findMany({ where: { entityId } });
  const porCircuito = new Map<"BLANCO" | "NEGRO", typeof lines>();
  for (const l of lines) porCircuito.set(l.circuit, [...(porCircuito.get(l.circuit) ?? []), l]);

  let total = toDecimal(0);
  let number = "";
  await prisma.$transaction(async (tx) => {
    // Se numera sola, adentro de la transacción: dos devoluciones cargadas a la vez no se pisan
    // el número leyendo el mismo "último".
    number = await proximoNumeroDeDevolucion(tx);
    for (const [circuit, circuitLines] of porCircuito) {
      const account = accounts.find((a) => a.circuit === circuit);
      if (!account) throw new UserError(`No se encontró la ${CIRCUIT_LABELS[circuit]} de este cliente.`);

      const netAmount = circuitLines.reduce((acc, l) => acc.plus(l.subtotal), toDecimal(0));
      // Lo mismo que el remito: en Blanco lleva IVA, en Negro no.
      const ivaRate = circuit === "BLANCO" ? toDecimal(DEFAULT_IVA_RATE) : null;
      const ivaAmount = ivaRate ? netAmount.times(ivaRate).dividedBy(100).toDecimalPlaces(2) : null;
      const totalAmount = ivaAmount ? netAmount.plus(ivaAmount) : netAmount;
      total = total.plus(totalAmount);

      const nota = await tx.document.create({
        data: {
          accountId: account.id,
          type: "NOTA_CREDITO",
          number,
          date,
          currency,
          exchangeRate,
          netAmount,
          ivaRate,
          ivaAmount,
          totalAmount,
          reason: `Devolución — ${reason}`,
          entregaId,
          destinatarioId,
          createdById: user.id,
        },
      });
      if (ivaAmount) {
        await tx.documentTax.create({
          data: { documentId: nota.id, kind: "IVA", base: netAmount, rate: ivaRate, amount: ivaAmount },
        });
      }

      for (const l of circuitLines) {
        const documentLine = await tx.documentLine.create({
          data: {
            documentId: nota.id,
            productId: l.productId,
            quantity: l.quantity,
            pallets: l.pallets,
            cajas: l.cajas,
            botellas: l.botellas,
            unitPrice: l.unitPrice,
            precioBotellaUsd: l.precioBotellaUsd,
            subtotal: l.subtotal,
            estadoDevolucion: l.estado.estado,
            cajasRotas: l.estado.cajasRotas,
            botellasSanas: l.estado.botellasSanas,
            palletsRearmados: l.estado.palletsRearmados,
          },
        });
        await moverStockDeDevolucion(tx, {
          line: l,
          documentLineId: documentLine.id,
          date,
          motivo: `Devolución ${number}`,
          userId: user.id,
        });
      }
    }

    const nombres = new Map(
      (await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } }, select: { id: true, name: true, presentation: true } }))
        .map((p) => [p.id, `${p.name} ${p.presentation}`])
    );
    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Devolución",
      entityId,
      summary: `Devolución ${number} — ${entity.name} — ${formatMoney(total, currency)}`,
      cambios: [
        { campo: "Motivo", antes: null, despues: reason },
        ...(entregaId
          ? [
              {
                campo: "Viaje",
                antes: null,
                despues: (await tx.entrega.findUnique({ where: { id: entregaId }, select: { nombre: true } }))?.nombre ?? null,
              },
            ]
          : []),
        {
          campo: "Lo devuelto",
          antes: null,
          despues: lines
            .map((l) => `${nombres.get(l.productId) ?? "?"} × ${describirDevuelto(l)}`)
            .join("\n"),
        },
        { campo: "Nota de crédito", antes: null, despues: formatMoney(total, currency) },
      ],
    });
  });

  await reimputarEntidades(entityId);
  revalidatePath(`/cuentas-corrientes/${entity.slug}`);
  revalidatePath("/stock");
  revalidatePath("/produccion");
}

async function createRemitoCore(
  user: { id: string },
  formData: FormData,
  auditAction: AuditAction,
  /** Cómo estaba la entrega antes de editarla. Vacío en un alta. */
  antes?: Record<string, unknown> | null,
  /**
   * Al editar: la entrega que ésta reemplaza. Se borra DENTRO de la misma transacción, igual que en
   * producción: si el alta falla, la original sigue estando, y la verificación de stock compara
   * contra cómo estaba de verdad antes de editar.
   */
  reemplaza?: { documentId: string }
) {
  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new UserError("Falta la entidad.");

  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) throw new UserError("Entidad inexistente.");

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new UserError("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDateOverride = parseOptionalFormDate(formData.get("dueDate"));
  // La moneda es la de la cuenta del cliente, no un desplegable: mismo motivo que en las compras.
  const currency: Currency = entity.moneda;
  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  // En una cuenta en pesos, la cotización es con lo que se pasa a pesos el precio en dólares —el de
  // La Campechana—. Antes sólo se guardaba si el remito era en dólares, y se pasaba a mano.
  const exchangeRate = exchangeRateRaw ? parseNumeroEscrito(exchangeRateRaw, "cotización") : null;
  if (exchangeRate && !exchangeRate.greaterThan(0)) {
    throw new UserError("La cotización tiene que ser mayor a cero.");
  }
  const reason = String(formData.get("reason") || "").trim() || null;
  const { destinatarioId, entregaId } = await leerDestinatarioYEntrega(formData, entityId);

  const lines = await leerLineasDeProducto(formData, currency, exchangeRate);

  if (lines.length === 0) {
    throw new UserError("Cargá al menos una línea con producto, cantidad y precio.");
  }
  if (lines.some((l) => l.circuit !== "BLANCO" && l.circuit !== "NEGRO")) {
    throw new UserError("Circuito inválido en alguna línea.");
  }

  const pedidoIds = formData.getAll("pedidoId").map(String).filter(Boolean);

  const accounts = await prisma.account.findMany({ where: { entityId } });
  const accountByCircuit = new Map(accounts.map((a) => [a.circuit, a]));

  const linesByCircuit = new Map<"BLANCO" | "NEGRO", typeof lines>();
  for (const line of lines) {
    const group = linesByCircuit.get(line.circuit) ?? [];
    group.push(line);
    linesByCircuit.set(line.circuit, group);
  }

  let combinedTotal = toDecimal(0);

  await prisma.$transaction(async (tx) => {
    if (reemplaza) {
      await tx.paymentAllocation.deleteMany({ where: { documentId: reemplaza.documentId } });
      await tx.document.delete({ where: { id: reemplaza.documentId } });
    }

    for (const [circuit, circuitLines] of linesByCircuit) {
      const account = accountByCircuit.get(circuit);
      if (!account) throw new UserError(`No se encontró la cuenta ${circuit} de esta entidad.`);

      const lineData = circuitLines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        pallets: l.pallets,
        cajas: l.cajas,
        unitPrice: l.unitPrice,
        precioBotellaUsd: l.precioBotellaUsd,
        subtotal: l.subtotal,
      }));
      const netAmount = lineData.reduce((acc, l) => acc.plus(l.subtotal), toDecimal(0));
      // Blanco = facturado, así que ya lleva IVA; Negro no factura, sin IVA.
      const ivaRate = circuit === "BLANCO" ? toDecimal(DEFAULT_IVA_RATE) : null;
      const ivaAmount = ivaRate ? netAmount.times(ivaRate).dividedBy(100) : null;
      const totalAmount = ivaAmount ? netAmount.plus(ivaAmount) : netAmount;
      combinedTotal = combinedTotal.plus(totalAmount);

      const document = await tx.document.create({
        data: {
          accountId: account.id,
          type: "REMITO",
          number,
          date,
          dueDate: dueDateOverride ?? defaultDueDate(date, circuit),
          currency,
          exchangeRate,
          netAmount,
          ivaRate,
          ivaAmount,
          totalAmount,
          reason,
          destinatarioId,
          entregaId,
          createdById: user.id,
        },
      });

      for (const l of lineData) {
        const documentLine = await tx.documentLine.create({
          data: { ...l, documentId: document.id },
        });
        await moverStockDeLinea(tx, {
          line: l,
          documentLineId: documentLine.id,
          date,
          motivo: `Entrega remito ${number}`,
          tipo: "ENTREGA",
          userId: user.id,
        });
      }
    }

    if (pedidoIds.length > 0) {
      await tx.pedido.updateMany({
        where: { id: { in: pedidoIds }, entityId },
        data: { status: "ENTREGADO", deliveryDate: date },
      });
    }

    // Se puede entregar lo que todavía no está cargado: la producción se carga al final del día,
    // así que lo que se produce y se entrega el mismo día queda en negativo hasta entonces.

    const nombres = new Map(
      (await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
        select: { id: true, name: true },
      })).map((p) => [p.id, p.name])
    );
    const [viaje, destinatario] = await Promise.all([
      entregaId ? tx.entrega.findUnique({ where: { id: entregaId }, select: { nombre: true } }) : null,
      destinatarioId
        ? tx.destinatario.findUnique({ where: { id: destinatarioId }, select: { nombre: true } })
        : null,
    ]);

    await logAudit(tx, {
      userId: user.id,
      action: auditAction,
      entityType: "Remito",
      entityId,
      summary: `#${number} — ${entity.name} — ${formatMoney(combinedTotal, currency)}`,
      cambios: diffDeCampos(
        antes ?? null,
        {
          number,
          date,
          currency,
          exchangeRate,
          totalAmount: combinedTotal,
          reason,
          viaje: viaje?.nombre ?? null,
          destinatario: destinatario?.nombre ?? null,
          renglones: renglones(
            lines.map((l) => ({
              nombre: nombres.get(l.productId) ?? "?",
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            }))
          ),
        },
        CAMPOS_CON_RENGLONES
      ),
    });
  }, { timeout: 20000 });

  await reimputarEntidades(entity.id);
  revalidatePath(`/cuentas-corrientes/${entity.slug}`);
  revalidatePath("/entregas");
  revalidatePath("/dashboard-clientes");
  if (pedidoIds.length > 0) revalidatePath("/pedidos");
}

export async function createRemito(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  await createRemitoCore(user, formData, "CREATE");
}

async function getRemitoOrThrow(documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      remitoLinks: true,
      lines: { include: { product: { select: { name: true } }, cajaMovements: { select: { cajaId: true } } } },
      account: { include: { entity: true } },
      entrega: { select: { nombre: true } },
      destinatario: { select: { nombre: true } },
    },
  });
  if (!document) throw new UserError("El remito ya no existe.");
  if (document.type !== "REMITO" || document.lines.length === 0) {
    throw new UserError("Este comprobante no es una entrega.");
  }
  if (document.remitoLinks.length > 0) {
    throw new UserError("Este remito ya está facturado — hay que borrar la factura primero.");
  }
  return document;
}

export async function deleteRemito(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await getRemitoOrThrow(documentId);

  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });

    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Remito",
      entityId: document.account.entityId,
      summary: `#${document.number} — ${document.account.entity.name} — ${formatMoney(document.totalAmount, document.currency)}`,
      cambios: diffDeCampos(fotoDeComprobanteConLineas(document), null, CAMPOS_CON_RENGLONES),
    });
  });

  await reimputarEntidades(document.account.entityId);
  revalidatePath(`/cuentas-corrientes/${document.account.entity.slug}`);
  revalidatePath("/entregas");
  revalidatePath("/dashboard-clientes");
}

/**
 * Editar una entrega = borrar el comprobante existente y volver a correr el mismo núcleo con los
 * datos nuevos del formulario — evita duplicar la lógica de agrupar líneas por circuito y crear
 * documentos, a costa de generar un id de Document nuevo (el número puede quedar igual). Queda
 * como un solo UPDATE en el log, no un DELETE + CREATE.
 */
export async function updateRemito(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const original = await getRemitoOrThrow(documentId);

  await createRemitoCore(user, formData, "UPDATE", fotoDeComprobanteConLineas(original), { documentId });
}

/** Núcleo compartido por createCompra y updateCompra (que borra y vuelve a llamar a este núcleo)
 * — así una edición queda como un solo UPDATE en el log, no un DELETE + CREATE. */
/** El orden importa: primero lo que cuelga del documento, y la factura antes que el remito que
 * referencia, porque DocumentLink no tiene cascade. */
async function borrarCompraYSuFactura(
  tx: Prisma.TransactionClient,
  documentId: string,
  facturaId: string | null
) {
  await tx.itemMovement.deleteMany({ where: { documentId } });
  await tx.paymentAllocation.deleteMany({ where: { documentId } });
  if (facturaId) {
    await tx.documentLink.deleteMany({ where: { facturaId } });
    await tx.paymentAllocation.deleteMany({ where: { documentId: facturaId } });
    await tx.document.delete({ where: { id: facturaId } });
  }
  await tx.document.delete({ where: { id: documentId } });
}

async function createCompraCore(
  user: { id: string },
  formData: FormData,
  auditAction: AuditAction,
  /** Cómo estaba la compra antes de editarla. Vacío en un alta. */
  antes?: Record<string, unknown> | null,
  /**
   * Al editar: la compra que ésta reemplaza, que se borra DENTRO de la misma transacción. Antes se
   * borraba en una aparte, y si el alta fallaba la compra desaparecía; además la verificación de
   * stock no tendría contra qué comparar.
   */
  reemplaza?: { documentId: string; facturaId: string | null; itemIds: string[] }
) {
  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new UserError("Falta la entidad.");

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new UserError("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate"));

  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) throw new UserError("Entidad inexistente.");
  // **La moneda es la de la cuenta, no la del formulario.** Antes se elegía en un desplegable, y en
  // la cuenta de Cristian —que se lleva en dólares— una compra con precio en dólares se multiplicaba
  // por la cotización y entraba en pesos: U$S 20.000 quedaban como 20.000 × 1.500 "dólares". Un
  // comprobante en otra moneda que su cuenta además no se imputa, porque la imputación busca los de
  // su moneda.
  const currency: Currency = entity.moneda;
  const enCuentaEnDolares = currency === "USD";

  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  // En una cuenta en pesos, la cotización es con lo que se pasa a pesos un precio pactado en dólares
  // —el soplado de los envases—. En una en dólares no convierte nada: se guarda como referencia.
  const exchangeRate = exchangeRateRaw ? parseNumeroEscrito(exchangeRateRaw, "cotización") : null;
  if (exchangeRate && !exchangeRate.greaterThan(0)) {
    throw new UserError("La cotización tiene que ser mayor a cero.");
  }

  const itemIds = formData.getAll("lineItemId").map(String);
  const quantities = formData.getAll("lineQuantity").map(String);
  const unitPrices = formData.getAll("lineUnitPrice").map(String);
  const unitPricesUsd = formData.getAll("lineUnitPriceUsd").map(String);
  const circuits = formData.getAll("lineCircuit").map(String);
  const kilosPorLinea = formData.getAll("lineKilos").map(String);
  const preciosTonelada = formData.getAll("linePrecioTonelada").map(String);

  // Los campos llegan como arrays paralelos que se aparean por posición: si vinieran con distinto
  // largo, el precio de una línea caería en otra sin que nadie lo note.
  for (const [nombre, arr] of [
    ["cantidad", quantities],
    ["precio", unitPrices],
    ["circuito", circuits],
  ] as const) {
    if (arr.length !== itemIds.length) {
      throw new UserError(
        `El formulario llegó incompleto (${nombre}) — recargá la página y volvé a cargar la compra.`
      );
    }
  }
  // El precio en U$S es el único que puede no venir: un formulario sin ese campo manda el array
  // vacío, y eso significa "sin precio en dólares", no un error. Pero si viene, tiene que venir
  // completo — si no, el precio de una línea caería en otra.
  if (unitPricesUsd.length > 0 && unitPricesUsd.length !== itemIds.length) {
    throw new UserError(
      "El formulario llegó incompleto (precio en U$S) — recargá la página y volvé a cargar la compra."
    );
  }
  // Lo mismo con los kilos y el precio por tonelada del aceite: pueden no venir, pero si vienen, completos.
  for (const [nombre, arr] of [
    ["kilos", kilosPorLinea],
    ["precio por tonelada", preciosTonelada],
  ] as const) {
    if (arr.length > 0 && arr.length !== itemIds.length) {
      throw new UserError(
        `El formulario llegó incompleto (${nombre}) — recargá la página y volvé a cargar la compra.`
      );
    }
  }

  const categoriaPorItem = new Map(
    (
      await prisma.item.findMany({
        where: { id: { in: itemIds.filter(Boolean) } },
        select: { id: true, category: true, name: true },
      })
    ).map((i) => [i.id, i])
  );

  const lines = itemIds
    .map((itemId, i) => {
      const circuit = circuits[i] as "BLANCO" | "NEGRO";
      const kilosRaw = (kilosPorLinea[i] ?? "").trim();

      // **Aceite: kilos del ticket y precio por tonelada.** Los litros que entran al stock son una
      // cuenta (kilos ÷ 0,92), y el subtotal sale directo de los kilos —kilos ÷ 1000 × precio—, no
      // de litros × un precio por litro redondeado, que correría el total.
      if (kilosRaw) {
        const item = categoriaPorItem.get(itemId);
        if (item && item.category !== "ACEITE") {
          throw new UserError(`"${item.name}" no es aceite: los kilos son sólo para el aceite.`);
        }
        const kilos = parseNumeroEscrito(kilosRaw, "kilos");
        if (!kilos.greaterThan(0)) throw new UserError("Los kilos tienen que ser mayores a cero.");
        const tonRaw = (preciosTonelada[i] ?? "").trim();
        const precioTonelada = tonRaw ? parseNumeroEscrito(tonRaw, "precio por tonelada") : null;
        const quantity = litrosDeKilos(kilos).toDecimalPlaces(3);
        const enDolares = precioTonelada ? kilos.dividedBy(1000).times(precioTonelada) : toDecimal(0);
        if (precioTonelada && !enCuentaEnDolares && !exchangeRate) {
          throw new UserError(
            "El precio del aceite está en dólares y esta cuenta se lleva en pesos: cargá la cotización para pasarlo a pesos."
          );
        }
        const subtotal = (enCuentaEnDolares || !precioTonelada ? enDolares : enDolares.times(exchangeRate!)).toDecimalPlaces(2);
        return {
          itemId,
          quantity,
          unitPrice: quantity.isZero() ? toDecimal(0) : subtotal.dividedBy(quantity).toDecimalPlaces(4),
          unitPriceUsd: !enCuentaEnDolares && precioTonelada ? enDolares.dividedBy(quantity).toDecimalPlaces(6) : null,
          kilos,
          precioTonelada,
          subtotal,
          circuit,
        };
      }

      const usdRaw = (unitPricesUsd[i] ?? "").trim();
      const usd = usdRaw ? parseNumeroEscrito(usdRaw, "precio en U$S") : null;
      const quantity = parseNumeroOpcional(quantities[i] ?? "", "cantidad");
      // **Con cotización, el precio se escribe en la otra moneda que la de la cuenta**, y se convierte
      // acá y no en el navegador, porque es el que termina en la cuenta corriente: en una cuenta en
      // pesos se escribe en dólares (el soplado de los envases) y en una en dólares, en pesos. Sin
      // cotización, el precio ya está en la moneda de la cuenta y entra tal cual.
      const escrito = parseNumeroOpcional(unitPrices[i] ?? "", "precio unitario");
      const unitPrice = enCuentaEnDolares
        ? (usd ?? (exchangeRate ? escrito.dividedBy(exchangeRate).toDecimalPlaces(4) : escrito))
        : usd && exchangeRate
          ? usd.times(exchangeRate)
          : escrito;
      return {
        itemId,
        quantity,
        unitPrice,
        unitPriceUsd: !enCuentaEnDolares && usd && exchangeRate ? usd : null,
        kilos: null,
        precioTonelada: null,
        subtotal: quantity.times(unitPrice).toDecimalPlaces(2),
        circuit,
      };
    })
    // Sin exigir precio > 0: el pallet descartable entra gratis con la compra, y descartar esa
    // línea en silencio dejaba el remito incompleto sin que nadie se entere.
    .filter((l) => l.itemId && l.quantity.greaterThan(0));

  if (lines.length === 0) {
    throw new UserError("Cargá al menos una línea con insumo, cantidad y precio.");
  }
  if (lines.some((l) => l.circuit !== "BLANCO" && l.circuit !== "NEGRO")) {
    throw new UserError("Circuito inválido en alguna línea.");
  }

  // Un envase sin preforma asignada no sumaría a ninguna cuenta de preformas, y el faltante recién
  // aparecería cuando el proveedor reclame. Mejor no dejar cargarlo.
  const entidadLlevaPreformas = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { llevaCuentaPreformas: true },
  });
  if (entidadLlevaPreformas?.llevaCuentaPreformas) {
    const sinPreforma = await prisma.item.findMany({
      where: { id: { in: lines.map((l) => l.itemId) }, category: "ENVASES", preformaId: null },
      select: { name: true },
    });
    if (sinPreforma.length > 0) {
      throw new UserError(
        `${sinPreforma.map((i) => `"${i.name}"`).join(", ")} no tiene asignado un tipo de preforma, así que no se contaría en la cuenta de preformas. Asignáselo en Stock y volvé a intentar.`
      );
    }
  }

  const accounts = await prisma.account.findMany({ where: { entityId } });
  const accountByCircuit = new Map(accounts.map((a) => [a.circuit, a]));

  const linesByCircuit = new Map<"BLANCO" | "NEGRO", typeof lines>();
  for (const line of lines) {
    const group = linesByCircuit.get(line.circuit) ?? [];
    group.push(line);
    linesByCircuit.set(line.circuit, group);
  }

  const llevaStockPorItem = new Map(
    (
      await prisma.item.findMany({
        where: { id: { in: lines.map((l) => l.itemId) } },
        select: { id: true, llevaStock: true },
      })
    ).map((i) => [i.id, i.llevaStock])
  );

  // Datos de la factura del proveedor, cuando la compra ya viene con ella.
  const facturaNumber = String(formData.get("facturaNumber") || "").trim();
  const facturaDate = parseOptionalFormDate(formData.get("facturaDate"));

  let combinedTotal = toDecimal(0);

  await prisma.$transaction(async (tx) => {
    if (reemplaza) await borrarCompraYSuFactura(tx, reemplaza.documentId, reemplaza.facturaId);

    for (const [circuit, circuitLines] of linesByCircuit) {
      const account = accountByCircuit.get(circuit);
      if (!account) throw new UserError(`No se encontró la cuenta ${circuit} de esta entidad.`);

      const lineData = circuitLines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        unitPriceUsd: l.unitPriceUsd,
        kilos: l.kilos,
        precioTonelada: l.precioTonelada,
        subtotal: l.subtotal,
      }));
      // El neto sale de las líneas; en Blanco el IVA y las percepciones se suman encima, igual que
      // en un remito de venta. El desglose se guarda en DocumentTax, como en las facturas de gasto.
      const neto = lineData.reduce((acc, l) => acc.plus(l.subtotal), toDecimal(0));
      const { taxRows, totals } = impuestosDeCompra(formData, neto, circuit);
      combinedTotal = combinedTotal.plus(totals.totalAmount);

      const document = await tx.document.create({
        data: {
          accountId: account.id,
          type: "REMITO",
          number,
          date,
          dueDate,
          currency,
          exchangeRate,
          ...totals,
          createdById: user.id,
        },
      });

      await tx.purchaseLine.createMany({
        data: lineData.map((l) => ({ ...l, documentId: document.id })),
      });

      if (taxRows.length > 0) {
        await tx.documentTax.createMany({
          data: taxRows.map((row) => ({ ...row, documentId: document.id })),
        });
      }

      // El caso normal: el remito viene con su factura. Se crea acá misma, vinculada y con los
      // mismos importes, para no pedir dos veces el mismo dato. Cuando una factura engloba varios
      // remitos —o un remito se parte en dos— se deja vacío y se carga aparte desde la ficha.
      if (circuit === "BLANCO" && facturaNumber) {
        const factura = await tx.document.create({
          data: {
            accountId: account.id,
            type: "FACTURA",
            number: facturaNumber,
            date: facturaDate ?? date,
            dueDate: dueDate ?? defaultDueDate(facturaDate ?? date, "BLANCO"),
            currency,
            exchangeRate,
            ...totals,
            createdById: user.id,
          },
        });
        await tx.documentLink.create({
          data: { remitoId: document.id, facturaId: factura.id, amount: totals.totalAmount },
        });
        if (taxRows.length > 0) {
          await tx.documentTax.createMany({
            data: taxRows.map((row) => ({ ...row, documentId: factura.id })),
          });
        }
      }

      // Los insumos que no llevan stock quedan fuera: su gasto ya entró en el documento de arriba,
      // que es lo único que interesa de ellos. Generarles un ingreso sería inflar un número que
      // nada consume.
      await tx.itemMovement.createMany({
        data: lineData.filter((l) => llevaStockPorItem.get(l.itemId) !== false).map((l) => ({
          itemId: l.itemId,
          date,
          quantity: l.quantity,
          sourceKg: l.kilos,
          conversionFactor: l.kilos ? DENSIDAD_ACEITE : null,
          type: "INGRESO" as const,
          reason: `Compra a ${entity.name} — remito ${number}`,
          documentId: document.id,
          createdById: user.id,
        })),
      });
    }

    // El precio pactado en U$S queda como el vigente del insumo, para que el próximo remito lo
    // proponga solo. Los envases lo tienen fijo; las tapas lo mueven seguido y así se mantiene al día.
    for (const line of lines) {
      // El del aceite no: va por tonelada, y un "precio por litro en U$S" derivado no le sirve a nadie
      // como sugerencia para la próxima compra.
      if (line.unitPriceUsd && !line.kilos) {
        await tx.item.update({
          where: { id: line.itemId },
          data: { precioSopladoUsd: line.unitPriceUsd },
        });
      }
    }

    // Bajar una cantidad al editar puede sacar del stock algo que ya se consumió.
    await asegurarSinNegativos(tx, {
      insumos: [...lines.map((l) => l.itemId), ...(reemplaza?.itemIds ?? [])],
    });

    const nombres = new Map(
      (await tx.item.findMany({
        where: { id: { in: lines.map((l) => l.itemId) } },
        select: { id: true, name: true },
      })).map((i) => [i.id, i.name])
    );

    await logAudit(tx, {
      userId: user.id,
      action: auditAction,
      entityType: "Compra",
      entityId,
      summary: `#${number} — ${entity.name} — ${formatMoney(combinedTotal, currency)}`,
      cambios: diffDeCampos(
        antes ?? null,
        {
          number,
          date,
          currency,
          exchangeRate,
          totalAmount: combinedTotal,
          reason: null,
          viaje: null,
          destinatario: null,
          renglones: renglones(
            lines.map((l) => ({
              nombre: nombres.get(l.itemId) ?? "?",
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            }))
          ),
        },
        CAMPOS_CON_RENGLONES
      ),
    });
  });

  await reimputarEntidades(entity.id);
  revalidatePath(`/cuentas-corrientes/${entity.slug}`);
  revalidatePath("/stock");
  revalidatePath("/compras");
  revalidatePath("/dashboard-proveedores");
}

export async function createCompra(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  await createCompraCore(user, formData, "CREATE");
}

/**
 * La compra, y la factura que arrastra si la tiene.
 *
 * Una factura que cubre SÓLO esta compra es la que se creó junto con ella —el caso normal, el
 * remito que vino con su factura— y se rehace con la compra sin que nadie tenga que pensarlo. Una
 * que cubre varias es otra cosa: borrarla al editar una sola compra desfacturaría a las demás, así
 * que ahí sí hay que ir a borrarla a mano.
 */
async function getCompraOrThrow(documentId: string) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      purchaseLines: { include: { item: { select: { name: true } } } },
      // `facturaLinks` y no `remitoLinks`: son dos relaciones distintas, y los vínculos de una
      // factura son aquellos donde ELLA es la factura.
      remitoLinks: { include: { factura: { include: { facturaLinks: true } } } },
      account: { include: { entity: true } },
    },
  });
  if (!document) throw new UserError("La compra ya no existe.");
  if (document.type !== "REMITO" || document.purchaseLines.length === 0) {
    throw new UserError("Este comprobante no es una compra.");
  }

  const compartidas = document.remitoLinks.filter((l) => l.factura.facturaLinks.length > 1);
  if (compartidas.length > 0) {
    throw new UserError(
      `La factura #${compartidas[0].factura.number} cubre también otras compras — hay que borrarla primero.`
    );
  }

  return { ...document, facturaPropia: document.remitoLinks[0]?.factura ?? null };
}

export async function deleteCompra(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await getCompraOrThrow(documentId);

  await prisma.$transaction(async (tx) => {
    await borrarCompraYSuFactura(tx, documentId, document.facturaPropia?.id ?? null);
    // Lo que entró con esta compra puede haberse consumido ya.
    await asegurarSinNegativos(tx, { insumos: document.purchaseLines.map((l) => l.itemId) });

    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Compra",
      entityId: document.account.entityId,
      summary: `#${document.number} — ${document.account.entity.name} — ${formatMoney(document.totalAmount, document.currency)}`,
      cambios: diffDeCampos(fotoDeComprobanteConLineas(document), null, CAMPOS_CON_RENGLONES),
    });
  });

  await reimputarEntidades(document.account.entityId);
  revalidatePath(`/cuentas-corrientes/${document.account.entity.slug}`);
  revalidatePath("/stock");
  revalidatePath("/compras");
  revalidatePath("/dashboard-proveedores");
}

/** Igual patrón que updateRemito: borra el comprobante (revirtiendo el stock que había sumado)
 * y vuelve a correr el mismo núcleo con los datos nuevos del formulario, logueando un solo
 * UPDATE. */
export async function updateCompra(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await getCompraOrThrow(documentId);

  // La factura vuelve a crearse desde el formulario, que la trae precargada.
  await createCompraCore(user, formData, "UPDATE", fotoDeComprobanteConLineas(document), {
    documentId,
    facturaId: document.facturaPropia?.id ?? null,
    itemIds: document.purchaseLines.map((l) => l.itemId),
  });
}

export async function createFactura(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const accountId = String(formData.get("accountId") || "");
  const account = await getAccountOrThrow(accountId);
  if (account.circuit !== "BLANCO") {
    throw new UserError("Las facturas solo se cargan en la Cuenta 1 (c/factura).");
  }

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new UserError("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate")) ?? defaultDueDate(date, "BLANCO");
  // En la moneda de la cuenta; si se escribió en la otra, se convierte. El IVA y el total se calculan
  // después, sobre lo convertido, para que cierren exacto.
  const currency: Currency = account.entity.moneda;
  const { convertir, exchangeRate } = aLaMonedaDeLaCuenta(
    monedaEscrita(formData.get("currency"), currency),
    currency,
    leerCotizacion(formData.get("exchangeRate"))
  );

  const netAmount = convertir(parseAmount(formData.get("netAmount"), "neto"));
  const ivaRate = parseNumeroEscrito(String(formData.get("ivaRate") || DEFAULT_IVA_RATE), "IVA");
  const retentionAmount = convertir(parseNumeroOpcional(String(formData.get("retentionAmount") || ""), "retención"));
  const perceptionAmount = convertir(parseNumeroOpcional(String(formData.get("perceptionAmount") || ""), "percepción"));

  const ivaAmount = netAmount.times(ivaRate).dividedBy(100);
  const totalAmount = netAmount.plus(ivaAmount).plus(perceptionAmount).minus(retentionAmount);

  const remitoIds = formData.getAll("remitoId").map(String);
  const remitoAmounts = formData.getAll("remitoAmount").map(String);
  const remitoSelections = remitoIds
    .map((id, i) => ({ id, amount: parseNumeroOpcional(remitoAmounts[i] ?? "", "monto imputado") }))
    .filter((r) => r.id && r.amount.greaterThan(0));

  const delFormulario = await leerDestinatarioYEntrega(formData, account.entityId);

  await prisma.$transaction(async (tx) => {
    const factura = await tx.document.create({
      data: {
        accountId: account.id,
        type: "FACTURA",
        number,
        date,
        dueDate,
        currency,
        exchangeRate,
        netAmount,
        ivaRate,
        ivaAmount,
        retentionAmount,
        perceptionAmount,
        totalAmount,
        destinatarioId: delFormulario.destinatarioId,
        entregaId: delFormulario.entregaId,
        createdById: user.id,
      },
    });

    if (remitoSelections.length > 0) {
      const remitos = await tx.document.findMany({
        where: {
          id: { in: remitoSelections.map((r) => r.id) },
          accountId: account.id,
          type: "REMITO",
        },
        include: { remitoLinks: true, allocations: true, lines: { include: { product: true } }, purchaseLines: { include: { item: true } } },
      });
      if (remitos.length !== remitoSelections.length) {
        throw new UserError("Alguno de los remitos seleccionados ya no está disponible.");
      }

      const linkData = remitoSelections.map((selection) => {
        const remito = remitos.find((r) => r.id === selection.id)!;
        const pending = getDocumentEffect(remito);
        if (selection.amount.greaterThan(pending)) {
          throw new UserError(
            `El monto a facturar del remito #${remito.number} supera su saldo pendiente.`
          );
        }
        return { remitoId: remito.id, facturaId: factura.id, amount: selection.amount };
      });

      await tx.documentLink.createMany({ data: linkData });

      // La factura hereda el destinatario y el viaje de los remitos que cubre, cuando todos
      // coinciden y el formulario no dijo otra cosa. Es lo normal —una factura sale por los
      // remitos de un mismo cliente final y de un mismo camión— y evita volver a elegirlos;
      // si vinieran mezclados se deja vacío, que es más honesto que quedarse con el primero.
      const unanime = <T,>(valores: (T | null)[]): T | null => {
        const unicos = Array.from(new Set(valores));
        return unicos.length === 1 && unicos[0] !== null ? unicos[0] : null;
      };
      const heredado = {
        destinatarioId: delFormulario.destinatarioId ?? unanime(remitos.map((r) => r.destinatarioId)),
        entregaId: delFormulario.entregaId ?? unanime(remitos.map((r) => r.entregaId)),
      };
      if (heredado.destinatarioId || heredado.entregaId) {
        await tx.document.update({ where: { id: factura.id }, data: heredado });
      }
    }

    // Se relee dentro de la transacción porque el viaje y el destinatario pueden haberse heredado
    // de los remitos unas líneas más arriba.
    const guardada = await tx.document.findUniqueOrThrow({
      where: { id: factura.id },
      include: { entrega: { select: { nombre: true } }, destinatario: { select: { nombre: true } } },
    });

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Factura",
      entityId: account.entityId,
      summary: `#${number} — ${account.entity.name} — ${formatMoney(totalAmount, currency)}`,
      cambios: diffDeCampos(null, fotoDelDocumento(guardada), CAMPOS_DEL_COMPROBANTE),
    });
  });

  await reimputarEntidades(account.entityId);
  revalidatePath(`/cuentas-corrientes/${account.entity.slug}`);
}

/** Edita los montos de una factura ya cargada. No toca los remitos que tenga vinculados — para
 * cambiar eso hay que borrarla y volver a facturar. El saldo pendiente se recalcula solo porque
 * sale de totalAmount, no hay nada desnormalizado que actualizar. */
export async function updateFactura(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const factura = await prisma.document.findUnique({
    where: { id: documentId },
    include: { account: { include: { entity: true } } },
  });
  if (!factura) throw new UserError("La factura ya no existe.");
  if (factura.type !== "FACTURA") throw new UserError("Este comprobante no es una factura.");

  const number = String(formData.get("number") || "").trim();
  if (!number) throw new UserError("El número es obligatorio.");

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate")) ?? defaultDueDate(date, "BLANCO");
  // En la moneda de la cuenta; si se escribió en la otra, se convierte. El IVA y el total se calculan
  // después, sobre lo convertido, para que cierren exacto.
  const currency: Currency = factura.account.entity.moneda;
  const { convertir, exchangeRate } = aLaMonedaDeLaCuenta(
    monedaEscrita(formData.get("currency"), currency),
    currency,
    leerCotizacion(formData.get("exchangeRate"))
  );

  const netAmount = convertir(parseAmount(formData.get("netAmount"), "neto"));
  const ivaRate = parseNumeroEscrito(String(formData.get("ivaRate") || DEFAULT_IVA_RATE), "IVA");
  const retentionAmount = convertir(parseNumeroOpcional(String(formData.get("retentionAmount") || ""), "retención"));
  const perceptionAmount = convertir(parseNumeroOpcional(String(formData.get("perceptionAmount") || ""), "percepción"));

  const ivaAmount = netAmount.times(ivaRate).dividedBy(100);
  const totalAmount = netAmount.plus(ivaAmount).plus(perceptionAmount).minus(retentionAmount);

  await prisma.document.update({
    where: { id: documentId },
    data: {
      number,
      date,
      dueDate,
      currency,
      exchangeRate,
      netAmount,
      ivaRate,
      ivaAmount,
      retentionAmount,
      perceptionAmount,
      totalAmount,
    },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Factura",
    entityId: factura.account.entityId,
    summary: `#${number} — ${factura.account.entity.name} — ${formatMoney(totalAmount, currency)}`,
    cambios: diffDeCampos(
      fotoDelDocumento(factura),
      fotoDelDocumento({
        ...factura,
        number,
        date,
        dueDate,
        currency,
        exchangeRate,
        netAmount,
        ivaRate,
        ivaAmount,
        retentionAmount,
        perceptionAmount,
        totalAmount,
      }),
      CAMPOS_DEL_COMPROBANTE
    ),
  });

  await reimputarEntidades(factura.account.entityId);
  revalidatePath(`/cuentas-corrientes/${factura.account.entity.slug}`);
}

/** Borrar una factura "desfactura" los remitos que tenía vinculados (vuelven a pendiente). */
export async function deleteFactura(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const factura = await prisma.document.findUnique({
    where: { id: documentId },
    include: { account: { include: { entity: true } } },
  });
  if (!factura) throw new UserError("La factura ya no existe.");
  if (factura.type !== "FACTURA") throw new UserError("Este comprobante no es una factura.");

  await prisma.$transaction(async (tx) => {
    await tx.documentLink.deleteMany({ where: { facturaId: documentId } });
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });

    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Factura",
      entityId: factura.account.entityId,
      summary: `#${factura.number} — ${factura.account.entity.name} — ${formatMoney(factura.totalAmount, factura.currency)}`,
      cambios: diffDeCampos(fotoDelDocumento(factura), null, CAMPOS_DEL_COMPROBANTE),
    });
  });

  await reimputarEntidades(factura.account.entityId);
  revalidatePath(`/cuentas-corrientes/${factura.account.entity.slug}`);
}

/**
 * El cheque de un cobro o de un pago. Cuando entra —cobro de un cliente— se crea; cuando sale
 * —pago a un proveedor— se elige de la cartera y se marca entregado. Es el mismo papel las dos
 * veces, y por eso se puede responder de quién vino y a quién se le dio.
 */
async function aplicarCheque(
  tx: Prisma.TransactionClient,
  params: {
    formData: FormData;
    paymentId: string;
    method: PaymentMethod;
    amount: Prisma.Decimal;
    circuit: Circuit;
    userId: string;
    esPago: boolean;
  }
) {
  if (!esMetodoCheque(params.method)) return;

  // Uno o varios cheques de la cartera: se entregan todos con este pago.
  const chequeIds = params.formData
    .getAll("chequeId")
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (chequeIds.length > 0) {
    if (!params.esPago) throw new UserError("Los cheques de la cartera se entregan al pagar, no al cobrar.");
    await entregarCheques(tx, { paymentId: params.paymentId, chequeIds, amount: params.amount });
    return;
  }

  // Sin cheque elegido de la cartera, se carga uno nuevo. Si es un pago, ese cheque no entró por
  // ningún cobro —es propio, o conseguido en un cambio— y nace directamente entregado.
  await crearChequeRecibido(tx, {
    paymentId: params.paymentId,
    formData: params.formData,
    amount: params.amount,
    esEcheq: params.method === "ECHEQ",
    userId: params.userId,
    yaEntregado: params.esPago,
  });
}

/**
 * Una retención sufrida cancela la deuda del cliente como cualquier pago, pero no es plata: nunca
 * llegó a una caja. El destino se descarta acá y no sólo en el formulario, porque si entrara igual
 * la tesorería contaría plata que no existe.
 */
function leerRetencion(formData: FormData, method: PaymentMethod) {
  if (method !== "RETENCION") {
    return {
      retentionKind: null,
      destino: String(formData.get("destino") || ""),
      proveedorId: String(formData.get("proveedorId") || ""),
      proveedorCircuit: leerCircuito(formData.get("proveedorCircuit")),
    };
  }

  const raw = String(formData.get("retentionKind") || "");
  if (!(raw in RETENTION_KIND_LABELS)) throw new UserError("Elegí el tipo de retención.");
  return { retentionKind: raw as RetentionKind, destino: "", proveedorId: "", proveedorCircuit: null };
}

/** El circuito que vino del formulario, o null si no vino ninguno (el campo puede no existir). */
function leerCircuito(raw: FormDataEntryValue | null): Circuit | null {
  const valor = String(raw || "");
  return valor === "BLANCO" || valor === "NEGRO" ? valor : null;
}

/**
 * Lo que no existe en la cuenta en negro: el echeq —que es bancario y queda registrado— y la
 * retención, que la practica un cliente sobre una factura. El formulario ya no los ofrece; esto es
 * lo que de verdad lo impide, porque un formulario se puede saltear y porque el pago también se
 * edita desde otras dos pantallas.
 */
function validarMetodo(circuit: Circuit, method: PaymentMethod) {
  const motivo = motivoMetodoInvalido(circuit, method);
  if (motivo) throw new UserError(motivo);
}

/**
 * Revisa el destino ANTES de crear el pago. `applyPaymentDestino` corre después de escribirlo, así
 * que si el destino es inválido y recién ahí se rechaza, el pago ya quedó cargado sin destino y con
 * el saldo movido. Las mismas comprobaciones se repiten allá: esto es sólo para fallar a tiempo.
 */
async function validarDestino(params: {
  circuit: Circuit;
  method: PaymentMethod;
  isCobro: boolean;
  destino: string;
  proveedorId: string;
  proveedorCircuit: Circuit | null;
}) {
  if (!params.destino) return;

  if (params.destino === PROVEEDOR_DIRECTO_VALUE) {
    if (!params.isCobro) throw new UserError('"Directo a un proveedor" solo aplica a cobros de clientes.');
    if (!params.proveedorId) throw new UserError("Elegí a qué proveedor fue directo el pago.");
    // El pago que se le genera al proveedor vive en su cuenta, así que le corren las reglas de esa
    // cuenta y no las del cobro. Cuando son distintas hay que decirlo, o el mensaje habla de una
    // cuenta en negro mientras la pantalla muestra un cobro en blanco.
    const circuitProveedor = params.proveedorCircuit ?? params.circuit;
    const motivo = motivoMetodoInvalido(circuitProveedor, params.method);
    if (motivo) {
      throw new UserError(
        circuitProveedor === params.circuit
          ? motivo
          : `${motivo} El cobro es de la ${CIRCUIT_LABELS[params.circuit]}, pero se imputa a la ${CIRCUIT_LABELS[circuitProveedor]} del proveedor.`
      );
    }
    return;
  }

  // Cualquier caja, con pagos de cualquier cuenta: se puede pagar en Blanco desde Caja Bufano y en
  // Negro desde el Galicia.
  const tesoreria = await prisma.entity.findUnique({ where: { id: params.destino } });
  if (!tesoreria || tesoreria.type !== "TESORERIA") throw new UserError("Destino inválido.");
}

/**
 * Aplica el destino/origen elegido para un cobro/pago recién creado (o recreado al editar):
 * - Tesorería (Banco Galicia / Caja Bufano): genera el Document AJUSTE que suma/resta su saldo,
 *   vinculado al Payment por sourcePaymentId (se borra solo si se borra el Payment).
 * - "Directo a un proveedor" (solo cobros): crea un segundo Payment en la cuenta del proveedor
 *   elegido, imputado por FIFO, y vincula ambos pagos por linkedPaymentId. No pasa por ninguna
 *   tesorería porque la plata nunca llegó a la empresa.
 * - Sin destino (""): no hace nada — el pago queda sin asignar, como cualquier pago histórico.
 */
async function applyPaymentDestino(params: {
  userId: string;
  payment: {
    id: string;
    date: Date;
    amount: Prisma.Decimal;
    /** La cotización con la que se hizo, cuando la cuenta va en dólares. */
    exchangeRate: Prisma.Decimal | null;
    /** Los pesos que se escribieron, cuando la cuenta va en dólares. */
    amountArs: Prisma.Decimal | null;
    method: PaymentMethod;
    circuit: Circuit;
    /** El de la transferencia: va también al pago del proveedor, que es el que sale en su orden. */
    numeroOperacion: string | null;
  };
  entity: { id: string; name: string };
  /**
   * Al editar un cobro directo: la orden de pago en la que estaba el pago del proveedor que se
   * reemplaza. El pago nuevo vuelve a esa orden si es del mismo proveedor y la misma cuenta; si no,
   * la orden se quedaba sin pagos (así quedó vacía la 0003).
   */
  heredarOrden?: { ordenPagoId: string; accountId: string } | null;
  /** Si este pago es un cobro (entra plata, ej. desde la página/ficha de clientes) o un pago a
   * proveedor (sale plata) — viene explícito del form en vez de derivarse de entity.type porque
   * una entidad AMBOS puede recibir cobros y pagos según desde qué página se cargue. */
  isCobro: boolean;
  destino: string;
  proveedorId: string;
  /** La cuenta del proveedor que se cancela con el cobro directo. Puede no ser la del cobro: la
   * plata no cambia de circuito por pasar de mano, y un cobro en negro cancela igual una factura
   * en blanco. Sin nada elegido se usa la del cobro, que es lo que hacía antes. */
  proveedorCircuit: Circuit | null;
  /** Moneda de la cuenta desde la que se cobró. */
  monedaOrigen: Currency;
  /** Cotización tipeada en el formulario, si las dos cuentas van en monedas distintas. */
  cotizacionProveedor: string;
}) {
  const { userId, payment, entity, isCobro, destino, proveedorId, monedaOrigen, cotizacionProveedor } =
    params;
  if (!destino) return;

  if (destino === PROVEEDOR_DIRECTO_VALUE) {
    if (!isCobro) throw new UserError('"Directo a un proveedor" solo aplica a cobros de clientes.');
    if (!proveedorId) throw new UserError("Elegí a qué proveedor fue directo el pago.");

    const circuitProveedor = params.proveedorCircuit ?? payment.circuit;
    // El pago que se le genera al proveedor vive en su cuenta, así que le corren las reglas de esa
    // cuenta y no las del cobro: un echeq no puede terminar cancelando una deuda en negro.
    validarMetodo(circuitProveedor, payment.method);

    const proveedorAccount = await prisma.account.findUnique({
      where: { entityId_circuit: { entityId: proveedorId, circuit: circuitProveedor } },
      include: { entity: { select: { name: true, moneda: true } } },
    });
    if (!proveedorAccount) throw new UserError("No se encontró la cuenta del proveedor elegido.");

    // El monto no se puede copiar tal cual si las dos cuentas van en monedas distintas: un cobro de
    // $1.512.000 a un proveedor que lleva la cuenta en dólares son U$S 1.000, no U$S 1.512.000.
    const monedaProveedor = proveedorAccount.entity.moneda;
    const { monto: montoProveedor, cotizacion } = convertirEntreCuentas(
      payment.amount,
      monedaOrigen,
      monedaProveedor,
      cotizacionProveedor,
      proveedorAccount.entity.name
    );

    const proveedorAllocations = await allocateFifo(proveedorAccount.id, montoProveedor, monedaProveedor);
    const linkedPayment = await prisma.payment.create({
      data: {
        accountId: proveedorAccount.id,
        date: payment.date,
        amount: montoProveedor,
        currency: monedaProveedor,
        exchangeRate: cotizacion,
        method: payment.method,
        numeroOperacion: payment.numeroOperacion,
        reference:
          circuitProveedor === payment.circuit
            ? `Cobro directo de ${entity.name}`
            : `Cobro directo de ${entity.name} (${CIRCUIT_LABELS[payment.circuit]})`,
        linkedPaymentId: payment.id,
        ordenPagoId:
          params.heredarOrden && params.heredarOrden.accountId === proveedorAccount.id ? params.heredarOrden.ordenPagoId : null,
        createdById: userId,
      },
    });
    if (proveedorAllocations.length > 0) {
      await prisma.paymentAllocation.createMany({
        data: proveedorAllocations.map((a) => ({
          paymentId: linkedPayment.id,
          documentId: a.documentId,
          amount: a.amount,
        })),
      });
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { linkedPaymentId: linkedPayment.id },
    });
    return;
  }

  const tesoreriaDestino = await prisma.entity.findUnique({ where: { id: destino } });
  if (!tesoreriaDestino || tesoreriaDestino.type !== "TESORERIA") {
    throw new UserError("Destino inválido.");
  }
  // La cuenta única de la caja, sea cual sea el circuito del pago. Ver `circuitoDeTesoreria`.
  const treasuryAccount = await prisma.account.findUnique({
    where: {
      entityId_circuit: { entityId: destino, circuit: circuitoDeTesoreria(tesoreriaDestino.name) },
    },
    include: { entity: true },
  });
  if (!treasuryAccount) throw new UserError("Destino inválido.");

  const category: TreasuryMovementCategory = isCobro ? "COBRO" : "PAGO_PROVEEDOR";
  const enPesos = pesosDelPago(payment, monedaOrigen);
  const signedAmount = isCobro ? enPesos : enPesos.negated();
  await prisma.document.create({
    data: {
      accountId: treasuryAccount.id,
      type: "AJUSTE",
      number: `P-${payment.id.slice(-8)}`,
      date: payment.date,
      currency: "ARS",
      netAmount: enPesos,
      totalAmount: signedAmount,
      reason:
        monedaOrigen === "USD" && payment.exchangeRate
          ? `${isCobro ? "Cobro de" : "Pago a"} ${entity.name} — ${PAYMENT_METHOD_LABELS[payment.method]} — ${formatMoney(payment.amount, "USD")} a ${payment.exchangeRate.toString()}`
          : `${isCobro ? "Cobro de" : "Pago a"} ${entity.name} — ${PAYMENT_METHOD_LABELS[payment.method]}`,
      treasuryCategory: category,
      sourcePaymentId: payment.id,
      createdById: userId,
    },
  });
  await prisma.payment.update({ where: { id: payment.id }, data: { treasuryId: destino } });
}

/**
 * **La caja lleva pesos, siempre.** El monto del pago está en la moneda de la cuenta, así que en
 * una cuenta en dólares —la de Cristian— hay que multiplicarlo por la cotización antes de tocar la
 * caja. Sin esto, pagarle U$S 5.000 a 1.500 descontaba 5.000 pesos de Caja Bufano en vez de
 * 7.500.000: la caja quedaba con plata que ya no está.
 *
 * Usa los pesos que se escribieron al cargarlo. El `times` es el plan B para los pagos viejos,
 * cargados antes de que se guardaran: pierde unos pesos por el redondeo, pero es muchísimo más cerca
 * que copiar los dólares.
 */
function pesosDelPago(
  payment: { amount: Prisma.Decimal; exchangeRate: Prisma.Decimal | null; amountArs: Prisma.Decimal | null },
  moneda: Currency
) {
  if (moneda !== "USD") return payment.amount;
  return payment.amountArs ?? (payment.exchangeRate ? payment.amount.times(payment.exchangeRate) : payment.amount);
}

/**
 * Que la caja tenga la plata, antes de grabar nada. Ver `asegurarCajaAlcanza`.
 *
 * `quitar` son los movimientos de caja que la operación va a borrar: al editar un pago, el que
 * generó la versión anterior. Si el pago cambia de caja, la vieja también se mira — sacarle un cobro
 * puede dejarla en rojo aunque la nueva reciba la plata.
 */
async function verificarCajaDelPago(params: {
  destino: string;
  isCobro: boolean;
  date: Date;
  enPesos: Prisma.Decimal;
  movimientosAnteriores?: { id: string; accountId: string }[];
}) {
  const anteriores = params.movimientosAnteriores ?? [];
  const tesoreria =
    params.destino && params.destino !== PROVEEDOR_DIRECTO_VALUE
      ? await prisma.entity.findUnique({ where: { id: params.destino }, include: { accounts: true } })
      : null;
  const cuentaNueva =
    tesoreria?.type === "TESORERIA"
      ? tesoreria.accounts.find((a) => a.circuit === circuitoDeTesoreria(tesoreria.name))
      : undefined;

  const cuentas = new Set([...anteriores.map((m) => m.accountId), ...(cuentaNueva ? [cuentaNueva.id] : [])]);
  for (const accountId of cuentas) {
    await asegurarCajaAlcanza(accountId, {
      quitar: anteriores.filter((m) => m.accountId === accountId).map((m) => m.id),
      agregar:
        cuentaNueva?.id === accountId
          ? { date: params.date, monto: params.isCobro ? params.enPesos : params.enPesos.negated() }
          : null,
    });
  }
}

export async function createPaymentForEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new UserError("Falta el cliente o proveedor.");

  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new UserError("Cuenta inválida.");

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
    include: { entity: true },
  });
  if (!account) throw new UserError("No se encontró la cuenta de esta entidad.");

  const date = parseFormDate(formData.get("date"));
  const method = String(formData.get("method") || "EFECTIVO") as PaymentMethod;
  const reference = String(formData.get("reference") || "").trim() || null;
  const numeroOperacion = leerNumeroOperacion(formData, method);
  const { retentionKind, destino, proveedorId, proveedorCircuit } = leerRetencion(formData, method);
  // Si este pago entra (cobro a un cliente) o sale (pago a un proveedor): viene explícito del form
  // porque una entidad AMBOS recibe las dos cosas según desde qué pantalla se cargue.
  const isCobro = formData.get("isCobro") === "1";
  validarMetodo(circuit, method);
  await validarDestino({ circuit, method, isCobro, destino, proveedorId, proveedorCircuit });

  // En una cuenta en dólares se escribe lo que realmente salió del banco —pesos— y la cotización,
  // y el pago se acredita en dólares. Es la cuenta que hoy se hace a mano; guardarla acá deja
  // reconstruir después cuántos pesos fueron y a cuánto.
  const { amount, exchangeRate, amountArs } = montoDelPago(formData, account.entity.moneda);
  // El viaje decide contra qué se imputa: un cobro del camión 4 cancela comprobantes del camión
  // 4 y ninguno más. Sin viaje se imputa contra lo que tampoco lo tiene.
  const { entregaId } = await leerDestinatarioYEntrega(formData, entityId);
  const nombreDelViajeNuevo = entregaId
    ? ((await prisma.entrega.findUnique({ where: { id: entregaId }, select: { nombre: true } }))?.nombre ??
      null)
    : null;
  const alcance = await alcanceDeImputacion(entityId, entregaId);
  const allocations = await allocateFifo(account.id, amount, account.entity.moneda, alcance);

  await verificarCajaDelPago({
    destino,
    isCobro,
    date,
    enPesos: pesosDelPago({ amount, exchangeRate, amountArs }, account.entity.moneda),
  });

  const payment = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        accountId: account.id,
        date,
        amount,
        currency: account.entity.moneda,
        exchangeRate,
        method,
        retentionKind,
        reference,
        numeroOperacion,
        entregaId,
        amountArs,
        createdById: user.id,
      },
    });

    if (allocations.length > 0) {
      await tx.paymentAllocation.createMany({
        data: allocations.map((a) => ({
          paymentId: payment.id,
          documentId: a.documentId,
          amount: a.amount,
        })),
      });
    }

    await aplicarCheque(tx, {
      formData,
      paymentId: payment.id,
      method,
      // Los cheques son en pesos: en una cuenta en dólares se comparan contra los pesos escritos.
      amount: amountArs ?? amount,
      circuit,
      userId: user.id,
      esPago: !isCobro,
    });

    return payment;
  });

  await applyPaymentDestino({
    userId: user.id,
    payment: { id: payment.id, date, amount, exchangeRate, amountArs, method, circuit, numeroOperacion },
    entity: account.entity,
    isCobro,
    monedaOrigen: account.entity.moneda,
    cotizacionProveedor: String(formData.get("cotizacionProveedor") || ""),
    destino,
    proveedorId,
    proveedorCircuit,
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Pago",
    entityId: entityId,
    summary: `${isCobro ? "Cobro de" : "Pago a"} ${account.entity.name} — ${formatMoney(amount)} — ${PAYMENT_METHOD_LABELS[method]}`,
    cambios: diffDeCampos(
      null,
      fotoDelPago({
        date,
        amount,
        currency: account.entity.moneda,
        amountArs,
        exchangeRate,
        method: PAYMENT_METHOD_LABELS[method],
        retentionKind,
        reference,
        numeroOperacion,
        circuito: CIRCUIT_LABELS[circuit],
        viaje: nombreDelViajeNuevo,
      }),
      CAMPOS_DEL_PAGO
    ),
  });

  await reimputarEntidades(entityId, proveedorId);
  revalidatePath(`/cuentas-corrientes/${account.entity.slug}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
  revalidatePath("/tesoreria");
}

export async function deletePayment(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const paymentId = String(formData.get("paymentId") || "");
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { account: { include: { entity: true } }, entrega: { select: { nombre: true } } },
  });
  if (!payment) throw new UserError("El pago ya no existe.");

  const linkedPayment = payment.linkedPaymentId
    ? await prisma.payment.findUnique({
        where: { id: payment.linkedPaymentId },
        include: { account: { include: { entity: true } } },
      })
    : null;

  // Un pago que está en una orden de pago es parte de un papel que ya se firmó: borrarlo dejaba la
  // orden sin pagos. Primero se anula la orden.
  const enOrden = payment.ordenPagoId ?? linkedPayment?.ordenPagoId;
  if (enOrden) {
    const orden = await prisma.ordenPago.findUnique({ where: { id: enOrden }, select: { numero: true } });
    throw new UserError(
      `Este pago está en la orden de pago N° ${String(orden?.numero ?? "").padStart(4, "0")}. Anulá la orden primero (desde Órdenes de pago) y después borrá el pago.`
    );
  }

  // Las cajas donde este pago dejó plata: borrar un cobro se la saca, y eso puede dejarlas en rojo.
  const cajasDelPago = await prisma.document.findMany({
    where: { sourcePaymentId: { in: [paymentId, ...(linkedPayment ? [linkedPayment.id] : [])] } },
    select: { accountId: true },
  });

  await prisma.$transaction(async (tx) => {
    // Antes de borrar: la FK desvincula sola, pero el estado no vuelve solo y el cheque quedaría
    // entregado a nadie, fuera de la cartera y sin poder usarse otra vez.
    await devolverChequesALaCartera(tx, paymentId);
    await tx.paymentAllocation.deleteMany({ where: { paymentId } });
    await tx.payment.delete({ where: { id: paymentId } });
    if (linkedPayment) {
      await devolverChequesALaCartera(tx, linkedPayment.id);
      await tx.paymentAllocation.deleteMany({ where: { paymentId: linkedPayment.id } });
      await tx.payment.delete({ where: { id: linkedPayment.id } });
    }

    await asegurarSinNegativos(tx, { cuentas: cajasDelPago.map((d) => d.accountId) });

    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Pago",
      entityId: payment.account.entityId,
      summary: `${payment.account.entity.name} — ${formatMoney(payment.amount, payment.currency)} — ${PAYMENT_METHOD_LABELS[payment.method]}`,
      cambios: diffDeCampos(
        fotoDelPago({
          date: payment.date,
          amount: payment.amount,
          currency: payment.currency,
          amountArs: payment.amountArs,
          exchangeRate: payment.exchangeRate,
          method: PAYMENT_METHOD_LABELS[payment.method],
          retentionKind: payment.retentionKind,
          reference: payment.reference,
          numeroOperacion: payment.numeroOperacion,
          circuito: CIRCUIT_LABELS[payment.account.circuit],
          viaje: payment.entrega?.nombre ?? null,
        }),
        null,
        CAMPOS_DEL_PAGO
      ),
    });
  });

  await reimputarEntidades(payment.account.entityId, linkedPayment?.account.entityId);
  revalidatePath(`/cuentas-corrientes/${payment.account.entity.slug}`);
  if (linkedPayment) revalidatePath(`/cuentas-corrientes/${linkedPayment.account.entity.slug}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
  revalidatePath("/tesoreria");
}

/** Edita un pago — si cambia el monto o la cuenta (circuito), se borran las imputaciones viejas
 * y se vuelve a correr allocateFifo con los datos nuevos, mismo camino que crear un pago. El
 * destino/origen (Document de tesorería o pago vinculado a un proveedor) se deshace por completo
 * y se vuelve a generar desde cero con los datos nuevos — más simple y seguro que tratar de
 * adivinar la transición entre los distintos casos. */
export async function updatePayment(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const paymentId = String(formData.get("paymentId") || "");
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { account: true, entrega: { select: { nombre: true } } },
  });
  if (!payment) throw new UserError("El pago ya no existe.");

  // La foto de cómo estaba, antes de pisarlo: después no hay de dónde sacarla.
  const antesDelPago = fotoDelPago({
    date: payment.date,
    amount: payment.amount,
    currency: payment.currency,
    amountArs: payment.amountArs,
    exchangeRate: payment.exchangeRate,
    method: PAYMENT_METHOD_LABELS[payment.method],
    retentionKind: payment.retentionKind,
    reference: payment.reference,
    numeroOperacion: payment.numeroOperacion,
    circuito: CIRCUIT_LABELS[payment.account.circuit],
    viaje: payment.entrega?.nombre ?? null,
  });

  const entityId = payment.account.entityId;
  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new UserError("Cuenta inválida.");

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
    include: { entity: true },
  });
  if (!account) throw new UserError("No se encontró la cuenta de esta entidad.");

  const date = parseFormDate(formData.get("date"));
  // Misma conversión que al crear: en una cuenta en dólares se edita en pesos y se guarda la
  // división. Sin esto, editar un pago de esa cuenta guardaba los pesos como si fueran dólares.
  const { amount, exchangeRate, amountArs } = montoDelPago(formData, account.entity.moneda);
  const method = String(formData.get("method") || "EFECTIVO") as PaymentMethod;
  const reference = String(formData.get("reference") || "").trim() || null;
  const numeroOperacion = leerNumeroOperacion(formData, method);
  const { retentionKind, destino, proveedorId, proveedorCircuit } = leerRetencion(formData, method);
  const isCobro = formData.get("isCobro") === "1";
  const { entregaId } = await leerDestinatarioYEntrega(formData, entityId);
  const nombreDelViaje = entregaId
    ? ((await prisma.entrega.findUnique({ where: { id: entregaId }, select: { nombre: true } }))?.nombre ??
      null)
    : null;
  validarMetodo(circuit, method);
  await validarDestino({ circuit, method, isCobro, destino, proveedorId, proveedorCircuit });

  const oldLinkedPaymentId = payment.linkedPaymentId;
  const oldLinkedPayment = oldLinkedPaymentId
    ? await prisma.payment.findUnique({
        where: { id: oldLinkedPaymentId },
        include: { account: { include: { entity: true } } },
      })
    : null;

  // Editar un pago borra su movimiento de caja y lo vuelve a crear: se simula eso entero, con la caja
  // vieja y la nueva, antes de tocar nada.
  await verificarCajaDelPago({
    destino,
    isCobro,
    date,
    enPesos: pesosDelPago({ amount, exchangeRate, amountArs }, account.entity.moneda),
    movimientosAnteriores: await prisma.document.findMany({
      where: { sourcePaymentId: paymentId },
      select: { id: true, accountId: true },
    }),
  });

  // **Los cheques del pago quedan como están, salvo que el formulario traiga otros.** El de editar
  // no tiene campos de cheque, y antes rehacía igual el cheque desde el formulario: tiraba "falta el
  // número del cheque" y no dejaba editar ningún pago hecho con cheques, ni para cambiarle la fecha.
  // Para cambiar los cheques se borra el pago y se carga de nuevo.
  const traeCheques = formData.getAll("chequeId").some(Boolean) || Boolean(formData.get("chequeNumero"));
  const conservaCheques = esMetodoCheque(method) && esMetodoCheque(payment.method) && !traeCheques;

  await prisma.$transaction(async (tx) => {
    if (!conservaCheques) {
      // Editar un pago rehace todo lo que colgaba de él, y el cheque entra en eso: vuelve a la
      // cartera y se lo reasigna abajo con lo que venga del formulario.
      await devolverChequesALaCartera(tx, paymentId);
    }
    await tx.paymentAllocation.deleteMany({ where: { paymentId } });
    await tx.document.deleteMany({ where: { sourcePaymentId: paymentId } });
    // Solo el lado "cobro" (con el selector de Proveedor) puede rearmar el vínculo desde cero —
    // si se edita el lado receptor (el pago generado en la cuenta del proveedor), no hay forma de
    // volver a elegir destino, así que borrar el vínculo acá borraría el cobro original sin poder
    // recrearlo.
    if (oldLinkedPayment && isCobro) {
      await tx.paymentAllocation.deleteMany({ where: { paymentId: oldLinkedPayment.id } });
      await tx.payment.delete({ where: { id: oldLinkedPayment.id } });
    }

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        accountId: account.id,
        date,
        amount,
        currency: account.entity.moneda,
        exchangeRate,
        method,
        retentionKind,
        reference,
        numeroOperacion,
        entregaId,
        amountArs,
        treasuryId: null,
        linkedPaymentId: isCobro ? null : payment.linkedPaymentId,
      },
    });

    if (conservaCheques) {
      // Se quedan los mismos cheques, así que el monto tiene que seguir siendo lo que valen: un
      // cheque no cambia de importe porque se edite el pago.
      const enPesos = amountArs ?? amount;
      const entregados = await tx.cheque.findMany({ where: { entregadoEnId: paymentId } });
      const recibido = await tx.cheque.findUnique({ where: { recibidoEnId: paymentId } });
      const valen = entregados.length > 0
        ? entregados.reduce((acc, c) => acc.plus(c.amount), toDecimal(0))
        : recibido?.amount;
      if (valen && !valen.equals(enPesos)) {
        if (recibido && entregados.length === 0 && recibido.estado === "EN_CARTERA") {
          // El de un cobro que todavía está en cartera se corrige junto con el cobro: es el mismo papel.
          await tx.cheque.update({ where: { id: recibido.id }, data: { amount: enPesos } });
        } else {
          throw new UserError(
            `Los cheques de este pago valen ${formatMoney(valen)} y el monto quedaría en ${formatMoney(enPesos)}. Para cambiar los cheques, borrá el pago y cargalo de nuevo.`
          );
        }
      }
      return;
    }

    // El cheque que ya existía se borró con `devolverChequesALaCartera` sólo si había salido; el que
    // entró con este cobro sigue vivo, así que se actualiza en vez de duplicarlo.
    const yaTiene = await tx.cheque.findUnique({ where: { recibidoEnId: paymentId } });
    if (yaTiene) await tx.cheque.delete({ where: { id: yaTiene.id } });
    await aplicarCheque(tx, {
      formData,
      paymentId,
      method,
      // Los cheques son en pesos: en una cuenta en dólares se comparan contra los pesos escritos.
      amount: amountArs ?? amount,
      circuit,
      userId: user.id,
      esPago: formData.get("isCobro") !== "1",
    });
  });

  const allocations = await allocateFifo(
    account.id,
    amount,
    account.entity.moneda,
    await alcanceDeImputacion(entityId, entregaId)
  );
  if (allocations.length > 0) {
    await prisma.paymentAllocation.createMany({
      data: allocations.map((a) => ({ paymentId, documentId: a.documentId, amount: a.amount })),
    });
  }

  await applyPaymentDestino({
    userId: user.id,
    payment: { id: paymentId, date, amount, exchangeRate, amountArs, method, circuit, numeroOperacion },
    entity: account.entity,
    isCobro,
    monedaOrigen: account.entity.moneda,
    cotizacionProveedor: String(formData.get("cotizacionProveedor") || ""),
    destino,
    proveedorId,
    proveedorCircuit,
    heredarOrden:
      oldLinkedPayment?.ordenPagoId ? { ordenPagoId: oldLinkedPayment.ordenPagoId, accountId: oldLinkedPayment.accountId } : null,
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Pago",
    entityId,
    summary: `${isCobro ? "Cobro de" : "Pago a"} ${account.entity.name} — ${formatMoney(amount)} — ${PAYMENT_METHOD_LABELS[method]}`,
    cambios: diffDeCampos(
      antesDelPago,
      fotoDelPago({
        date,
        amount,
        currency: account.entity.moneda,
        amountArs,
        exchangeRate,
        method: PAYMENT_METHOD_LABELS[method],
        retentionKind,
        reference,
        numeroOperacion,
        circuito: CIRCUIT_LABELS[circuit],
        viaje: nombreDelViaje,
      }),
      CAMPOS_DEL_PAGO
    ),
  });

  await reimputarEntidades(entityId, proveedorId, oldLinkedPayment?.account.entityId);
  revalidatePath(`/cuentas-corrientes/${account.entity.slug}`);
  if (oldLinkedPayment) revalidatePath(`/cuentas-corrientes/${oldLinkedPayment.account.entity.slug}`);
  revalidatePath("/pagos-clientes");
  revalidatePath("/pagos-proveedores");
  revalidatePath("/dashboard-clientes");
  revalidatePath("/dashboard-proveedores");
  revalidatePath("/tesoreria");
}

export async function moveRemitoToBlanco(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { account: { include: { entity: true } }, remitoLinks: true },
  });
  if (!document) notFound();
  if (document.type !== "REMITO") throw new UserError("Solo los remitos se pueden mover de cuenta.");
  if (document.remitoLinks.length > 0) {
    throw new UserError("Este remito ya está facturado, no se puede mover.");
  }
  if (document.account.circuit === "BLANCO") {
    throw new UserError("El remito ya está en la Cuenta 1 (c/factura).");
  }

  const blancoAccount = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId: document.account.entityId, circuit: "BLANCO" } },
  });
  if (!blancoAccount) throw new UserError("No se encontró la Cuenta 1 (c/factura) de esta entidad.");

  await prisma.document.update({
    where: { id: document.id },
    data: { accountId: blancoAccount.id },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Remito",
    entityId: document.account.entityId,
    summary: `#${document.number} — ${document.account.entity.name} — pasado a Cuenta 1 (c/factura)`,
    cambios: [
      { campo: "Cuenta", antes: CIRCUIT_LABELS[document.account.circuit], despues: CIRCUIT_LABELS.BLANCO },
    ],
  });

  await reimputarEntidades(document.account.entityId);
  revalidatePath(`/cuentas-corrientes/${document.account.entity.slug}`);
}

export async function createPrice(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  const circuit = String(formData.get("circuit") || "") as "BLANCO" | "NEGRO";
  const productId = String(formData.get("productId") || "");
  const currency = String(formData.get("currency") || "ARS") as Currency;
  const validFrom = parseFormDate(formData.get("validFrom"));
  const amount = parseAmount(formData.get("amount"), "precio");

  if (!entityId) throw new UserError("Falta la entidad.");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new UserError("Circuito inválido.");
  if (!productId) throw new UserError("Falta el producto.");

  const [entity, product] = await Promise.all([
    prisma.entity.findUnique({ where: { id: entityId } }),
    prisma.product.findUnique({ where: { id: productId } }),
  ]);

  await prisma.price.create({
    data: { entityId, circuit, productId, currency, validFrom, amount, createdById: user.id },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Precio",
    entityId,
    summary: `${product?.name ?? "Producto"} para ${entity?.name ?? "entidad"} — ${formatMoney(amount, currency)}`,
    cambios: [
      { campo: "Producto", antes: null, despues: product?.name ?? null },
      { campo: "Cuenta", antes: null, despues: CIRCUIT_LABELS[circuit] },
      { campo: "Precio", antes: null, despues: formatMoney(amount, currency) },
      { campo: "Vigente desde", antes: null, despues: formatFecha(validFrom) },
    ],
  });

  revalidatePath(`/cuentas-corrientes/${entity?.slug ?? entityId}`);
}

/* ─────────────────────────── Facturas de gasto ───────────────────────────
 * Un gasto es lo que factura un proveedor y no es una compra de insumos: el flete, el alquiler,
 * la luz, la ferretería. Usa el tipo GASTO, que en `getDocumentEffect` suma igual que una factura.
 */

/** Resuelve la cuenta y deja el gasto listo para escribir. El parseo del formulario vive en
 * `lib/gasto.ts`, que no toca la base y se puede probar solo. */
async function parseGasto(formData: FormData) {
  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new UserError("Falta el proveedor.");

  const gasto = leerGastoDelForm(formData);

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit: gasto.circuit } },
    include: { entity: true },
  });
  if (!account) throw new UserError("No se encontró la cuenta de esta entidad.");
  if (account.entity.type !== "PROVEEDOR" && account.entity.type !== "AMBOS") {
    throw new UserError("Los gastos se cargan en la cuenta de un proveedor.");
  }

  const date = parseFormDate(formData.get("date"));
  const dueDate = parseOptionalFormDate(formData.get("dueDate")) ?? defaultDueDate(date, gasto.circuit);

  // En la moneda de la cuenta del proveedor; si se escribió en la otra, se convierte todo el desglose.
  const currency: Currency = account.entity.moneda;
  const { convertir, exchangeRate } = aLaMonedaDeLaCuenta(
    monedaEscrita(formData.get("currency"), currency),
    currency,
    leerCotizacion(formData.get("exchangeRate"))
  );

  return {
    account,
    date,
    dueDate,
    ...gasto,
    currency,
    exchangeRate,
    taxRows: gasto.taxRows.map((r) => convertirMontos(r, convertir)),
    totals: convertirMontos(gasto.totals, convertir),
  };
}

/**
 * La subcuenta del gasto, si la cuenta del proveedor se divide (el alquiler y los gastos comunes de
 * Goloeste). Antes el formulario la mostraba y acá no se leía: el gasto quedaba sin subcuenta
 * aunque se la eligiera.
 */
async function subcuentaDelGasto(formData: FormData, entityId: string) {
  const { entregaId } = await leerDestinatarioYEntrega(formData, entityId);
  const nombre = entregaId
    ? ((await prisma.entrega.findUnique({ where: { id: entregaId }, select: { nombre: true } }))?.nombre ?? null)
    : null;
  return { entregaId, nombre };
}

export async function createGasto(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  const g = await parseGasto(formData);
  const subcuenta = await subcuentaDelGasto(formData, g.account.entityId);

  await prisma.$transaction(async (tx) => {
    const gasto = await tx.document.create({
      data: {
        accountId: g.account.id,
        type: "GASTO",
        number: g.number,
        date: g.date,
        dueDate: g.dueDate,
        currency: g.currency,
        exchangeRate: g.exchangeRate,
        expenseCategory: g.expenseCategory,
        reason: g.reason,
        entregaId: subcuenta.entregaId,
        ...g.totals,
        createdById: user.id,
      },
    });

    if (g.taxRows.length > 0) {
      await tx.documentTax.createMany({
        data: g.taxRows.map((row) => ({ ...row, documentId: gasto.id })),
      });
    }

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Gasto",
      entityId: g.account.entityId,
      summary: `#${g.number} — ${g.account.entity.name} — ${EXPENSE_CATEGORY_LABELS[g.expenseCategory]} — ${formatMoney(g.totals.totalAmount, g.currency)}`,
      cambios: diffDeCampos(null, fotoDelGastoCargado(g, subcuenta.nombre), CAMPOS_DEL_COMPROBANTE),
    });
  });

  await reimputarEntidades(g.account.entityId);
  revalidatePath(`/cuentas-corrientes/${g.account.entity.slug}`);
}

/** Edita un gasto ya cargado. El desglose se borra y se vuelve a escribir entero — es más corto que
 * conciliar fila por fila y no hay nada colgando de esas filas. Las imputaciones de pagos no se
 * tocan: el pendiente sale de totalAmount, igual que en updateFactura. */
/** La foto de lo que trae el formulario de gasto, en la forma que compara `diffDeCampos`. */
function fotoDelGastoCargado(g: Awaited<ReturnType<typeof parseGasto>>, subcuenta: string | null) {
  return fotoDelComprobante({
    tipo: DOCUMENT_TYPE_LABELS.GASTO,
    number: g.number,
    date: g.date,
    dueDate: g.dueDate,
    currency: g.currency,
    exchangeRate: g.exchangeRate,
    netAmount: g.totals.netAmount,
    ivaAmount: g.totals.ivaAmount,
    perceptionAmount: g.totals.perceptionAmount,
    retentionAmount: g.totals.retentionAmount,
    totalAmount: g.totals.totalAmount,
    reason: g.reason,
    rubro: EXPENSE_CATEGORY_LABELS[g.expenseCategory],
    viaje: subcuenta,
    destinatario: null,
  });
}

export async function updateGasto(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const existente = await prisma.document.findUnique({
    where: { id: documentId },
    include: { entrega: { select: { nombre: true } } },
  });
  if (!existente) throw new UserError("El gasto ya no existe.");
  if (existente.type !== "GASTO") throw new UserError("Este comprobante no es un gasto.");

  const g = await parseGasto(formData);
  // El selector sólo aparece si la cuenta se divide: sin el campo, la subcuenta que tenía se queda.
  const traeSubcuenta = formData.has("entregaId");
  const subcuenta = traeSubcuenta
    ? await subcuentaDelGasto(formData, g.account.entityId)
    : { entregaId: existente.entregaId, nombre: existente.entrega?.nombre ?? null };

  await prisma.$transaction(async (tx) => {
    await tx.documentTax.deleteMany({ where: { documentId } });

    await tx.document.update({
      where: { id: documentId },
      data: {
        accountId: g.account.id,
        number: g.number,
        date: g.date,
        dueDate: g.dueDate,
        currency: g.currency,
        exchangeRate: g.exchangeRate,
        expenseCategory: g.expenseCategory,
        reason: g.reason,
        entregaId: subcuenta.entregaId,
        ...g.totals,
      },
    });

    if (g.taxRows.length > 0) {
      await tx.documentTax.createMany({
        data: g.taxRows.map((row) => ({ ...row, documentId })),
      });
    }

    await logAudit(tx, {
      userId: user.id,
      action: "UPDATE",
      entityType: "Gasto",
      entityId: g.account.entityId,
      summary: `#${g.number} — ${g.account.entity.name} — ${EXPENSE_CATEGORY_LABELS[g.expenseCategory]} — ${formatMoney(g.totals.totalAmount, g.currency)}`,
      cambios: diffDeCampos(fotoDelDocumento(existente), fotoDelGastoCargado(g, subcuenta.nombre), CAMPOS_DEL_COMPROBANTE),
    });
  });

  await reimputarEntidades(g.account.entityId);
  revalidatePath(`/cuentas-corrientes/${g.account.entity.slug}`);
}

export async function deleteGasto(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const documentId = String(formData.get("documentId") || "");
  const gasto = await prisma.document.findUnique({
    where: { id: documentId },
    include: { account: { include: { entity: true } } },
  });
  if (!gasto) throw new UserError("El gasto ya no existe.");
  if (gasto.type !== "GASTO") throw new UserError("Este comprobante no es un gasto.");

  await prisma.$transaction(async (tx) => {
    // Las filas de DocumentTax se van solas por el cascade; las imputaciones no tienen cascade.
    await tx.paymentAllocation.deleteMany({ where: { documentId } });
    await tx.document.delete({ where: { id: documentId } });

    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Gasto",
      entityId: gasto.account.entityId,
      summary: `#${gasto.number} — ${gasto.account.entity.name} — ${formatMoney(gasto.totalAmount, gasto.currency)}`,
      cambios: diffDeCampos(fotoDelDocumento(gasto), null, CAMPOS_DEL_COMPROBANTE),
    });
  });

  await reimputarEntidades(gasto.account.entityId);
  revalidatePath(`/cuentas-corrientes/${gasto.account.entity.slug}`);
}

/**
 * Las tres formas de cargar algo en la cuenta de un proveedor detrás de un solo botón. El
 * formulario manda `tipo` y acá se reparte, así el modal es uno y la elección se hace adentro, con
 * cada opción explicada — que es donde se decide mal cuando los botones están sueltos y sin
 * contexto.
 */
export async function cargarEnCuenta(formData: FormData) {
  const tipo = String(formData.get("tipo") || "");
  if (tipo === "COMPRA") return createCompra(formData);
  if (tipo === "GASTO") return createGasto(formData);
  if (tipo === "NOTA") return createDocumentForEntity(formData);
  throw new UserError("Elegí qué querés cargar.");
}
