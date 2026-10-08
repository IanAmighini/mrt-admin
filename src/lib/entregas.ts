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
  /** El saldo abierto por circuito. Una parte puede tocar los dos —un camión lleva remitos en
   * negro y facturas en blanco— y sin esto no hay forma de decir qué quedó afuera de cada cuenta. */
  saldoPorCircuito: Record<"BLANCO" | "NEGRO", Prisma.Decimal>;
  comprobantes: number;
};

function totalDeDocumentos(docs: EntregaDocumento[]): Prisma.Decimal {
  return sumDecimals(docs.map((doc) => getDocumentEffect(doc)));
}

export async function getEntregasDeEntidad(entityId: string): Promise<EntregaConSaldo[]> {
  const entregas = await prisma.entrega.findMany({
    where: { entityId },
    orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
    include: {
      documents: { select: DOC_SELECT },
      payments: { select: { amount: true, account: { select: { circuit: true } } } },
    },
  });

  return entregas.map((e) => {
    const total = totalDeDocumentos(e.documents);
    const cobrado = sumDecimals(e.payments.map((p) => toDecimal(p.amount)));
    const saldoPorCircuito = { BLANCO: ZERO, NEGRO: ZERO };
    for (const doc of e.documents) {
      saldoPorCircuito[doc.account.circuit] = saldoPorCircuito[doc.account.circuit].plus(
        getDocumentEffect(doc)
      );
    }
    for (const pago of e.payments) {
      saldoPorCircuito[pago.account.circuit] = saldoPorCircuito[pago.account.circuit].minus(
        toDecimal(pago.amount)
      );
    }
    return {
      saldoPorCircuito,
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

/** Un renglón de lo que llevó un viaje: una línea de producto de uno de sus remitos. */
export type RenglonDeViaje = {
  id: string;
  fecha: Date;
  vencimiento: Date | null;
  remito: string;
  /** Una devolución resta: sus renglones van en negativo. */
  devolucion: boolean;
  circuito: "BLANCO" | "NEGRO";
  marca: { name: string; oilType: string };
  formato: string;
  pallets: number;
  cajas: number;
  botellas: number;
  unidades: number;
  precioUnitario: Prisma.Decimal | null;
  importe: Prisma.Decimal;
};

export type CuadroDeViaje = {
  id: string | null;
  nombre: string;
  destino: string | null;
  fecha: Date | null;
  remitos: string[];
  renglones: RenglonDeViaje[];
  movimientos: MovimientoDeEntrega[];
  total: Prisma.Decimal;
  cobrado: Prisma.Decimal;
  saldo: Prisma.Decimal;
};

/**
 * Todos los viajes (o partes) de una cuenta, cada uno con su cuadro: lo que llevó, renglón por
 * renglón, y al lado la deuda, los cobros y el saldo corrido. Es la planilla de liquidación de
 * camiones que se armaba a mano, uno abajo del otro.
 *
 * Al final va lo que no tiene viaje —el saldo inicial, un cobro que todavía no se asignó—, para
 * que la suma de los cuadros dé el saldo de la cuenta.
 */
export async function getCuadrosDeViajes(entityId: string): Promise<CuadroDeViaje[]> {
  const [entregas, sueltosDocs, sueltosPagos] = await Promise.all([
    prisma.entrega.findMany({ where: { entityId }, orderBy: [{ fecha: "desc" }, { createdAt: "desc" }] }),
    prisma.document.findMany({
      where: { account: { entityId }, entregaId: null },
      select: { ...DOC_SELECT, lines: { include: { product: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    prisma.payment.findMany({
      where: { account: { entityId }, entregaId: null },
      select: PAY_SELECT,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const docsPorViaje = await prisma.document.findMany({
    where: { entregaId: { in: entregas.map((e) => e.id) } },
    select: { ...DOC_SELECT, lines: { include: { product: true } } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const pagosPorViaje = await prisma.payment.findMany({
    where: { entregaId: { in: entregas.map((e) => e.id) } },
    select: PAY_SELECT,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  type DocConLineas = (typeof docsPorViaje)[number];
  function cuadro(
    base: { id: string | null; nombre: string; destino: string | null; fecha: Date | null },
    docs: DocConLineas[],
    pagos: EntregaPago[]
  ): CuadroDeViaje {
    const renglones: RenglonDeViaje[] = docs.flatMap((doc) =>
      doc.lines.map((l) => {
        const bpp = l.product.boxesPerPallet ?? 0;
        const upb = l.product.unitsPerBox ?? 0;
        let pallets = l.pallets ?? 0;
        let cajas = l.cajas ?? 0;
        if (l.pallets === null || l.cajas === null) {
          const q = l.quantity.toNumber();
          pallets = Math.floor(q);
          cajas = bpp ? Math.round((q - pallets) * bpp) : 0;
        }
        const botellas = l.botellas ?? 0;
        const unidades = (pallets * bpp + cajas) * upb + botellas;
        const devolucion = doc.type === "NOTA_CREDITO";
        const signo = devolucion ? -1 : 1;
        return {
          id: l.id,
          fecha: doc.date,
          vencimiento: doc.dueDate,
          remito: doc.number,
          devolucion,
          circuito: doc.account.circuit,
          marca: { name: l.product.name, oilType: l.product.oilType },
          formato: l.product.presentation,
          pallets,
          cajas,
          botellas,
          unidades,
          precioUnitario: unidades > 0 ? l.subtotal.dividedBy(unidades) : null,
          importe: l.subtotal.times(signo),
        };
      })
    );

    const filas: Omit<MovimientoDeEntrega, "saldo">[] = [
      ...docs.map((doc) => ({
        id: doc.id,
        fecha: doc.date,
        detalle: doc.destinatario ? doc.destinatario.nombre : (doc.reason ?? ""),
        circuito: doc.account.circuit,
        monto: getDocumentEffect(doc),
        tipo: "COMPROBANTE" as const,
        documento: doc,
      })),
      ...pagos.map((pago) => ({
        id: pago.id,
        fecha: pago.date,
        detalle: pago.reference ?? "",
        circuito: pago.account.circuit,
        monto: toDecimal(pago.amount).negated(),
        tipo: "PAGO" as const,
        pago,
      })),
    ]
      .filter((f) => !f.monto.isZero())
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    let corrido = ZERO;
    const movimientos = filas.map((f) => {
      corrido = corrido.plus(f.monto);
      return { ...f, saldo: corrido };
    });

    const total = sumDecimals(docs.map((d) => getDocumentEffect(d)));
    const cobrado = sumDecimals(pagos.map((p) => toDecimal(p.amount)));
    return {
      ...base,
      remitos: [...new Set(docs.filter((d) => d.lines.length > 0 && d.type !== "NOTA_CREDITO").map((d) => d.number))],
      renglones,
      movimientos,
      total,
      cobrado,
      saldo: total.minus(cobrado),
    };
  }

  const cuadros = entregas.map((e) =>
    cuadro(
      { id: e.id, nombre: e.nombre, destino: e.destino, fecha: e.fecha },
      docsPorViaje.filter((d) => d.entregaId === e.id),
      pagosPorViaje.filter((p) => p.entregaId === e.id)
    )
  );
  const sinAsignar = cuadro({ id: null, nombre: "Sin asignar", destino: null, fecha: null }, sueltosDocs, sueltosPagos);
  if (sinAsignar.movimientos.length > 0) cuadros.push(sinAsignar);
  return cuadros;
}
