import "server-only";
import type { Prisma, TaxKind } from "@prisma/client";
import { prisma } from "./prisma";
import { formatFecha } from "./period";
import { diffDeCampos } from "./audit";
import type { DiaFichero } from "./fichero-calculo";
import { formatMoney, formatNumeroExacto } from "./money";
import { OTROS_TRIBUTOS } from "./impuestos";
import {
  CHEQUE_ESTADO_LABELS,
  CIRCUIT_LABELS,
  DOCUMENT_TYPE_LABELS,
  ESTADO_DEVOLUCION_LABELS,
  EXPENSE_CATEGORY_LABELS,
  PAYMENT_CONCEPTO_LABELS,
  PAYMENT_METHOD_LABELS,
  RETENTION_KIND_LABELS,
  TREASURY_MOVEMENT_CATEGORY_LABELS,
} from "./labels";

/**
 * **Las fotos de Actividad, sacadas de la base.** Antes cada acción armaba la suya con lo que
 * tenía a mano, y lo que quedaba afuera no se veía: a qué caja fue un cobro, sus cheques, la
 * factura de una compra, la cuenta de un remito. Una edición que tocaba sólo eso quedaba registrada
 * sin detalle (pedido de Ian del 30/10/2026: «que todo lo editable se guarde»).
 *
 * Se leen igual antes y después de guardar, así que comparan lo mismo: lo que no cambió no aparece.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const NOMBRE_DEL_TRIBUTO = new Map<TaxKind, string>([
  ...OTROS_TRIBUTOS.map((t) => [t.kind, t.label] as [TaxKind, string]),
  ["IVA", "IVA"],
  ["EXENTO", "Exento"],
  ["PERCEPCION_IIBB", "Ing. Brutos"],
  ["PERCEPCION_MUNICIPAL", "Percepción municipal"],
  ["IMPUESTO_INTERNO", "Impuesto interno"],
]);

const plata = (n: Prisma.Decimal | null | undefined, moneda: "ARS" | "USD" = "ARS") =>
  n === null || n === undefined ? "" : formatMoney(n, moneda);

/** Lo que se mira de un comprobante, con el nombre que le pone la pantalla. */
export const CAMPOS_DEL_DOCUMENTO = {
  tipo: "Tipo",
  titular: "Cuenta de",
  cuenta: "Cuenta",
  number: "Número",
  date: "Fecha",
  dueDate: "Vencimiento",
  currency: "Moneda",
  exchangeRate: "Cotización",
  netAmount: "Neto",
  ivaRate: "Alícuota IVA",
  ivaAmount: "IVA",
  perceptionAmount: "Percepciones",
  retentionAmount: "Retención",
  impuestos: "Desglose de impuestos",
  totalAmount: "Total",
  reason: "Detalle",
  rubro: "Rubro",
  categoria: "Tipo de movimiento",
  pase: "Pase con",
  viaje: "Viaje",
  destinatario: "A nombre de",
  renglones: "Líneas",
  factura: "Factura",
  remitos: "Remitos que factura",
  preformas: "Preformas entregadas",
} as const;

/** El comprobante tal como está guardado, o null si ya no existe. */
export async function fotoDelDocumentoGuardado(db: Db, documentId: string | null | undefined) {
  if (!documentId) return null;
  const d = await db.document.findUnique({
    where: { id: documentId },
    include: {
      account: { select: { circuit: true, entity: { select: { name: true, type: true } } } },
      entrega: { select: { nombre: true } },
      destinatario: { select: { nombre: true } },
      taxes: { orderBy: { kind: "asc" } },
      lines: { include: { product: { select: { name: true, presentation: true } } } },
      purchaseLines: { include: { item: { select: { name: true } } } },
      remitoLinks: { include: { factura: { select: { number: true, date: true, netAmount: true, ivaAmount: true, totalAmount: true } } } },
      facturaLinks: { include: { remito: { select: { number: true } } } },
      entregasPreforma: { include: { preforma: { select: { name: true } } } },
      contraparte: { select: { account: { select: { entity: { select: { name: true } } } } } },
      contraparteDe: { select: { account: { select: { entity: { select: { name: true } } } } } },
    },
  });
  if (!d) return null;
  const esCaja = d.account.entity.type === "TESORERIA";
  const moneda = d.currency;

  const renglones = [
    ...d.lines.map((l) => {
      const cuanto =
        l.pallets !== null || l.cajas !== null
          ? [l.pallets ? `${l.pallets} pallets` : null, l.cajas ? `${l.cajas} cajas` : null, l.botellas ? `${l.botellas} botellas` : null]
              .filter(Boolean)
              .join(" + ") || "0"
          : `${formatNumeroExacto(l.quantity)} pallets`;
      const precio = l.unitPrice.isZero() ? " sin cargo" : ` a ${plata(l.unitPrice, moneda)} el pallet`;
      const estado = l.estadoDevolucion
        ? ` (${ESTADO_DEVOLUCION_LABELS[l.estadoDevolucion]}${l.cajasRotas ? `, ${l.cajasRotas} cajas rotas` : ""}${l.botellasSanas ? `, ${l.botellasSanas} botellas sanas` : ""}${l.palletsRearmados === true ? ", rearmados" : l.palletsRearmados === false ? ", desarmados" : ""})`
        : "";
      return `${l.product.name} ${l.product.presentation} × ${cuanto}${precio}${estado}`;
    }),
    ...d.purchaseLines.map((l) => {
      const kilos = l.kilos ? ` (${formatNumeroExacto(l.kilos)} kg${l.precioTonelada ? ` a U$S ${formatNumeroExacto(l.precioTonelada)}/t` : ""})` : "";
      const usd = l.unitPriceUsd && !l.kilos ? ` (U$S ${formatNumeroExacto(l.unitPriceUsd)})` : "";
      const precio = l.unitPrice.isZero() ? " sin cargo" : ` a $${formatNumeroExacto(l.unitPrice)}`;
      return `${l.item.name} × ${formatNumeroExacto(l.quantity)}${kilos}${precio}${usd}`;
    }),
  ].join("\n");

  const pase = d.contraparte?.account.entity.name ?? d.contraparteDe?.account.entity.name ?? null;

  return {
    tipo: DOCUMENT_TYPE_LABELS[d.type],
    titular: d.account.entity.name,
    cuenta: esCaja ? null : CIRCUIT_LABELS[d.account.circuit],
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
    impuestos: d.taxes
      .map((t) => {
        const nombre = t.kind === "OTRO_TRIBUTO" && t.description ? t.description : (NOMBRE_DEL_TRIBUTO.get(t.kind) ?? t.kind);
        const alicuota = t.rate ? ` ${formatNumeroExacto(t.rate)}%` : "";
        const base = t.base ? ` sobre ${plata(t.base, moneda)}` : "";
        return `${nombre}${alicuota}${base}: ${plata(t.amount, moneda)}`;
      })
      .join("\n"),
    totalAmount: d.totalAmount,
    reason: d.reason,
    rubro: d.expenseCategory ? EXPENSE_CATEGORY_LABELS[d.expenseCategory] : null,
    categoria: d.treasuryCategory ? TREASURY_MOVEMENT_CATEGORY_LABELS[d.treasuryCategory] : null,
    pase,
    viaje: d.entrega?.nombre ?? null,
    destinatario: d.destinatario?.nombre ?? null,
    renglones,
    factura: d.remitoLinks
      .map((l) => `${l.factura.number} del ${formatFecha(l.factura.date)}: neto ${plata(l.factura.netAmount, moneda)}, IVA ${plata(l.factura.ivaAmount, moneda)}, total ${plata(l.factura.totalAmount, moneda)}`)
      .join("\n"),
    remitos: d.facturaLinks.map((l) => `#${l.remito.number} por ${plata(l.amount, moneda)}`).join("\n"),
    preformas: d.entregasPreforma
      .map((e) => `${e.preforma.name} × ${formatNumeroExacto(e.quantity)}${e.comprobante ? ` (${e.comprobante})` : ""}`)
      .join("\n"),
  };
}

/**
 * Una carga que quedó partida en varios comprobantes —el remito con líneas en las dos cuentas— se
 * ve como una sola: lo que coincide va una vez, y lo que no, renglón por renglón con su cuenta.
 */
export async function fotoDeVariosDocumentos(db: Db, documentIds: string[]) {
  const fotos = (await Promise.all(documentIds.map((id) => fotoDelDocumentoGuardado(db, id)))).filter(
    (f): f is NonNullable<typeof f> => f !== null
  );
  if (fotos.length <= 1) return fotos[0] ?? null;
  const texto = (v: unknown) =>
    v === null || v === undefined || v === "" ? "\u2014" : v instanceof Date ? formatFecha(v) : String(v);
  const unida: Record<string, string> = {};
  for (const campo of Object.keys(fotos[0]) as (keyof (typeof fotos)[number])[]) {
    const valores = fotos.map((f) => texto(f[campo]));
    unida[campo] = valores.every((v) => v === valores[0])
      ? valores[0]
      : fotos.map((f, i) => `${f.cuenta ?? f.titular}: ${valores[i]}`).join("\n");
  }
  return unida;
}

/** Lo que se mira de un pago o un cobro. */
export const CAMPOS_DEL_PAGO_GUARDADO = {
  titular: "Cuenta de",
  cuenta: "Cuenta",
  date: "Fecha",
  amount: "Monto",
  currency: "Moneda",
  amountArs: "Monto en pesos",
  exchangeRate: "Cotización",
  method: "Método",
  concepto: "Concepto",
  retentionKind: "Tipo de retención",
  reference: "Descripción",
  numeroOperacion: "N° de operación",
  destino: "Caja",
  directo: "Cobro directo con",
  cheques: "Cheques",
  viaje: "Viaje",
  ordenDePago: "Orden de pago",
} as const;

/** El pago tal como está guardado, con su caja, sus cheques y el cobro directo, o null si ya no existe. */
export async function fotoDelPagoGuardado(db: Db, paymentId: string | null | undefined) {
  if (!paymentId) return null;
  const p = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      account: { select: { circuit: true, entity: { select: { name: true } } } },
      treasury: { select: { name: true } },
      treasuryDocument: { select: { account: { select: { entity: { select: { name: true } } } } } },
      entrega: { select: { nombre: true } },
      ordenPago: { select: { numero: true } },
      chequeRecibido: true,
      chequesEntregados: { orderBy: { numero: "asc" } },
    },
  });
  if (!p) return null;
  const vinculado = p.linkedPaymentId
    ? await db.payment.findUnique({
        where: { id: p.linkedPaymentId },
        select: { amount: true, currency: true, account: { select: { circuit: true, entity: { select: { name: true } } } } },
      })
    : null;
  const cheques = [...(p.chequeRecibido ? [p.chequeRecibido] : []), ...p.chequesEntregados]
    .map(
      (c) =>
        `${c.esEcheq ? "Echeq" : "Cheque"} N° ${c.numero}${c.banco ? ` ${c.banco}` : ""} por ${plata(c.amount)}` +
        (c.fechaCobro ? `, se cobra el ${formatFecha(c.fechaCobro)}` : "") +
        (c.costoPct ? `, costo ${formatNumeroExacto(c.costoPct)}%` : "") +
        ` (${CHEQUE_ESTADO_LABELS[c.estado]})`
    )
    .join("\n");

  return {
    titular: p.account.entity.name,
    cuenta: CIRCUIT_LABELS[p.account.circuit],
    date: p.date,
    // Un aporte o un cobro a un proveedor se guardan en negativo, pero se cargaron en positivo.
    amount: p.concepto ? p.amount.abs() : p.amount,
    currency: p.currency,
    amountArs: p.concepto ? (p.amountArs?.abs() ?? null) : p.amountArs,
    exchangeRate: p.exchangeRate,
    method: PAYMENT_METHOD_LABELS[p.method],
    concepto: p.concepto ? PAYMENT_CONCEPTO_LABELS[p.concepto] : null,
    retentionKind: p.retentionKind ? RETENTION_KIND_LABELS[p.retentionKind] : null,
    reference: p.reference,
    numeroOperacion: p.numeroOperacion,
    destino: p.treasuryDocument?.account.entity.name ?? p.treasury?.name ?? null,
    directo: vinculado
      ? `${vinculado.account.entity.name}, ${CIRCUIT_LABELS[vinculado.account.circuit]}: ${plata(vinculado.amount.abs(), vinculado.currency)}`
      : null,
    cheques,
    viaje: p.entrega?.nombre ?? null,
    ordenDePago: p.ordenPago ? String(p.ordenPago.numero).padStart(4, "0") : null,
  };
}

// ---------------------------------------------------------------------------
// Sueldos
// ---------------------------------------------------------------------------

/** Una foto con campos que dependen de quién está: un empleado más es un renglón más. */
export type FotoConEtiquetas = { valores: Record<string, unknown>; etiquetas: Record<string, string> };

/** Lo que cambió entre dos fotos de ésas, con las etiquetas de las dos (alguien pudo entrar o salir). */
export function diffDeFotos(antes: FotoConEtiquetas | null, despues: FotoConEtiquetas | null) {
  return diffDeCampos(antes?.valores ?? null, despues?.valores ?? null, { ...antes?.etiquetas, ...despues?.etiquetas });
}

const ddmm = (fecha: string) => fecha.split("-").reverse().slice(0, 2).join("/");

/**
 * Un día del fichero: las marcas del reloj y lo corregido a mano. Va un campo por día, así una
 * corrección muestra ese día solo y no la semana entera.
 */
function textoDelDia(d: DiaFichero): string {
  const corregido = [
    d.entrada !== undefined ? `entrada ${d.entrada ?? "borrada"}` : null,
    d.salida !== undefined ? `salida ${d.salida ?? "borrada"}` : null,
  ].filter(Boolean);
  return `${d.marcas.join(" ") || "sin marcas"}${corregido.length ? ` → ${corregido.join(", ")}` : ""}`;
}

/** La planilla de sueldos tal como está: la cabecera y, de cada empleado, todo lo que se carga en la grilla. */
export async function fotoDeLaPlanilla(db: Db, planillaId: string): Promise<FotoConEtiquetas | null> {
  const p = await db.planillaDeSueldos.findUnique({
    where: { id: planillaId },
    include: {
      renglones: {
        include: {
          entity: { select: { name: true } },
          gasto: { select: { totalAmount: true } },
          pago: { select: { amount: true } },
        },
        orderBy: { entity: { name: "asc" } },
      },
    },
  });
  if (!p) return null;
  const caja = p.cajaId ? await db.entity.findUnique({ where: { id: p.cajaId }, select: { name: true } }) : null;
  const valores: Record<string, unknown> = {
    rango: `${formatFecha(p.desde)} al ${formatFecha(p.hasta)}`,
    estado: p.estado === "CERRADA" ? "Cerrada" : "Borrador",
    fechaDePago: p.fechaDePago,
    caja: caja?.name ?? null,
    feriados: p.feriados.map(ddmm).join(", "),
    bonosDe: p.bonosDe,
    feriadosDelMes: p.feriadosDelMes.map(ddmm).join(", "),
    notas: p.notas,
  };
  const etiquetas: Record<string, string> = {
    rango: "Semana",
    estado: "Estado",
    fechaDePago: "Fecha de pago",
    caja: "Caja de la que sale",
    feriados: "Feriados de la semana",
    bonosDe: "Bonos del mes",
    feriadosDelMes: "Feriados del mes de los bonos",
    notas: "Notas",
  };
  type Renglon = (typeof p.renglones)[number];
  const CAMPOS_DEL_RENGLON: [string, string, (r: Renglon) => unknown][] = [
    ["tarifa", "Jornal o sueldo", (r) => r.tarifa],
    ["horas", "Horas", (r) => r.horas],
    ["horasFeriado", "Horas de feriado", (r) => r.horasFeriado],
    ["presentismo", "Presentismo", (r) => r.presentismo],
    ["puntualidad", "Puntualidad", (r) => r.puntualidad],
    ["monotributo", "Monotributo", (r) => r.monotributo],
    ["descuentoACuenta", "Descuento a cuenta", (r) => r.descuentoACuenta],
    ["pagado", "Se le da", (r) => r.pagado],
    ["saldoAnterior", "Saldo anterior", (r) => r.saldoAnterior],
    ["comentario", "Comentario", (r) => r.comentario],
    ["gasto", "Gasto cargado", (r) => (r.gasto ? plata(r.gasto.totalAmount) : null)],
    ["pago", "Pago cargado", (r) => (r.pago ? plata(r.pago.amount) : null)],
  ];
  for (const r of p.renglones) {
    for (const [campo, etiqueta, valor] of CAMPOS_DEL_RENGLON) {
      valores[`${r.entityId}.${campo}`] = valor(r);
      etiquetas[`${r.entityId}.${campo}`] = `${r.entity.name} · ${etiqueta}`;
    }
    for (const [cuales, deLosBonos] of [[r.dias, false], [r.diasDelMes, true]] as const) {
      for (const d of Array.isArray(cuales) ? (cuales as DiaFichero[]) : []) {
        const clave = `${r.entityId}.${deLosBonos ? "mes" : "dia"}.${d.fecha}`;
        valores[clave] = textoDelDia(d);
        etiquetas[clave] = `${r.entity.name} · ${ddmm(d.fecha)}${d.arrastre ? " (viernes anterior)" : ""}${deLosBonos ? " (mes de los bonos)" : ""}`;
      }
    }
  }
  return { valores, etiquetas };
}
