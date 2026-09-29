import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { getDocumentEffect } from "@/lib/ledger";

/**
 * Los viajes de un cliente, con el saldo de cada uno.
 *
 * El saldo de un viaje es lo mismo que el de una cuenta pero acotado a sus comprobantes: lo que
 * suman menos lo cobrado. La resta de las imputaciones se cancela sola —lo imputado aparece de los
 * dos lados— así que alcanza con los totales y no hace falta recorrer `PaymentAllocation`.
 */
const DOC_SELECT = {
  id: true,
  type: true,
  number: true,
  date: true,
  dueDate: true,
  totalAmount: true,
  currency: true,
  reason: true,
  entregaId: true,
  remitoLinks: { select: { amount: true } },
  destinatario: { select: { id: true, nombre: true, taxId: true } },
  account: { select: { id: true, circuit: true } },
} satisfies Prisma.DocumentSelect;

const PAY_SELECT = {
  id: true,
  date: true,
  amount: true,
  currency: true,
  method: true,
  reference: true,
  entregaId: true,
  account: { select: { id: true, circuit: true } },
} satisfies Prisma.PaymentSelect;

export type EntregaDocumento = Prisma.DocumentGetPayload<{ select: typeof DOC_SELECT }>;
export type EntregaPago = Prisma.PaymentGetPayload<{ select: typeof PAY_SELECT }>;

export type EntregaConSaldo = {
  id: string;
  nombre: string;
  destino: string | null;
  fecha: Date;
  notas: string | null;
  /// Lo que suman los comprobantes del viaje, en las dos cuentas.
  total: Prisma.Decimal;
  cobrado: Prisma.Decimal;
  saldo: Prisma.Decimal;
  comprobantes: number;
};

function totalDeDocumentos(docs: EntregaDocumento[]): Prisma.Decimal {
  return sumDecimals(docs.map((doc) => getDocumentEffect(doc)));
}

export async function getEntregasDeEntidad(entityId: string): Promise<EntregaConSaldo[]> {
  const entregas = await prisma.entrega.findMany({
    where: { entityId },
    orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
    include: { documents: { select: DOC_SELECT }, payments: { select: { amount: true } } },
  });

  return entregas.map((e) => {
    const total = totalDeDocumentos(e.documents);
    const cobrado = sumDecimals(e.payments.map((p) => toDecimal(p.amount)));
    return {
      id: e.id,
      nombre: e.nombre,
      destino: e.destino,
      fecha: e.fecha,
      notas: e.notas,
      total,
      cobrado,
      saldo: total.minus(cobrado),
      comprobantes: e.documents.length,
    };
  });
}

/** Una fila del cuadro del viaje: un comprobante o un pago, con el saldo que deja atrás. */
export type MovimientoDeEntrega = {
  id: string;
  fecha: Date;
  detalle: string;
  circuito: "BLANCO" | "NEGRO";
  /// Con signo: suma lo que se le carga, resta lo que pagó.
  monto: Prisma.Decimal;
  saldo: Prisma.Decimal;
  tipo: "COMPROBANTE" | "PAGO";
  documento?: EntregaDocumento;
  pago?: EntregaPago;
};

export async function getEntregaDetalle(entregaId: string) {
  const entrega = await prisma.entrega.findUnique({
    where: { id: entregaId },
    include: {
      entity: true,
      createdBy: { select: { name: true } },
      documents: { select: DOC_SELECT, orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
      payments: { select: PAY_SELECT, orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!entrega) return null;

  const total = totalDeDocumentos(entrega.documents);
  const cobrado = sumDecimals(entrega.payments.map((p) => toDecimal(p.amount)));

  const filas: Omit<MovimientoDeEntrega, "saldo">[] = [
    ...entrega.documents.map((doc) => ({
      id: doc.id,
      fecha: doc.date,
      detalle: doc.destinatario ? doc.destinatario.nombre : (doc.reason ?? ""),
      circuito: doc.account.circuit,
      monto: getDocumentEffect(doc),
      tipo: "COMPROBANTE" as const,
      documento: doc,
    })),
    ...entrega.payments.map((pago) => ({
      id: pago.id,
      fecha: pago.date,
      detalle: pago.reference ?? "",
      circuito: pago.account.circuit,
      monto: toDecimal(pago.amount).negated(),
      tipo: "PAGO" as const,
      pago,
    })),
  ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  let corrido = ZERO;
  const movimientos: MovimientoDeEntrega[] = filas.map((fila) => {
    corrido = corrido.plus(fila.monto);
    return { ...fila, saldo: corrido };
  });

  return { entrega, movimientos, total, cobrado, saldo: total.minus(cobrado) };
}

/** Los viajes que se pueden elegir al cargar un comprobante o un pago de esta entidad. */
export async function getEntregasParaElegir(entityId: string) {
  return prisma.entrega.findMany({
    where: { entityId },
    orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
    select: { id: true, nombre: true, destino: true, fecha: true },
  });
}

export async function getDestinatarios(entityId: string) {
  return prisma.destinatario.findMany({
    where: { entityId },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, taxId: true },
  });
}
