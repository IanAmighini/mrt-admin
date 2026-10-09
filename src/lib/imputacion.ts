import "server-only";
import { Prisma } from "@prisma/client";
import { getDocumentEffect } from "./ledger";
import { prisma } from "./prisma";

type Tx = Prisma.TransactionClient;

/**
 * Rehace de cero qué cancela a qué en una cuenta: los cobros y los créditos —notas de crédito,
 * devoluciones, ajustes en contra— contra los comprobantes que suman deuda, el más viejo primero.
 *
 * **Por qué rehacerlo entero y no imputar cada cosa al cargarla.** Antes un cobro se imputaba sólo
 * en el momento de cargarlo, contra lo que hubiera pendiente en ese instante. Entonces:
 *  - un cobro por adelantado (el cliente paga antes del remito) quedaba "sin imputar" para siempre,
 *    y el remito que llegaba después figuraba sin pagar y vencido aunque el saldo diera cero;
 *  - una nota de crédito o una devolución bajaba el saldo pero no cancelaba nada, y la factura
 *    seguía vencida por el total.
 * El saldo siempre estuvo bien —es la suma de todo—; lo que estaba mal era a qué comprobante se le
 * restaba. Recalcularlo entero después de cada cambio hace que el resultado no dependa del orden
 * en que se cargaron las cosas, sólo de sus fechas.
 *
 * Reglas, las mismas que ya valían para los cobros:
 *  - **Por fecha**: cada crédito, del más viejo al más nuevo, cancela los comprobantes más viejos.
 *    Un cobro puede cancelar un comprobante de fecha posterior: eso es un pago por adelantado.
 *  - **Cada bolsa contra lo suyo**: un crédito con viaje (o subcuenta) sólo cancela comprobantes de
 *    ese viaje, y uno sin viaje sólo los que tampoco tienen. En una cuenta sin viajes, todos son
 *    "sin viaje" y se mezcla todo, como siempre.
 *  - **Misma moneda**.
 *  - Un pago en negativo (una corrección) no cancela nada: suma deuda por sí solo, vía el saldo.
 *  - **Un cobro a un proveedor es al revés**: es él el que nos paga lo que le vendimos, así que lo
 *    que se cancela es la venta (un crédito de su cuenta). Entra como una "deuda" más, que sólo
 *    puede cancelar un comprobante —la venta que eligió quien lo cargó, o cualquier crédito si no
 *    eligió ninguna—, y queda como una imputación en negativo: la venta deja de deber lo cobrado.
 */
export async function reimputarCuenta(tx: Tx, accountId: string) {
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: { entity: { select: { type: true } } },
  });
  // Las cajas no tienen comprobantes que cancelar: sus movimientos son la plata misma.
  if (!account || account.entity.type === "TESORERIA") return;

  const [documents, payments] = await Promise.all([
    tx.document.findMany({
      where: { accountId },
      select: {
        id: true,
        type: true,
        date: true,
        createdAt: true,
        currency: true,
        entregaId: true,
        totalAmount: true,
        remitoLinks: { select: { amount: true } },
      },
    }),
    tx.payment.findMany({
      where: { accountId },
      select: {
        id: true,
        date: true,
        createdAt: true,
        currency: true,
        entregaId: true,
        amount: true,
        concepto: true,
        cobraDocumentoId: true,
      },
    }),
  ]);

  const porFecha = (a: { date: Date; createdAt: Date }, b: { date: Date; createdAt: Date }) =>
    a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime();

  type Deuda = {
    tipo: "DOC" | "COBRO";
    id: string;
    date: Date;
    createdAt: Date;
    currency: string;
    entregaId: string | null;
    pendiente: Prisma.Decimal;
    /** Sólo un cobro que eligió qué venta paga. */
    soloContra: string | null;
  };
  const deudas: Deuda[] = [
    ...documents
      .map((d) => ({ tipo: "DOC" as const, id: d.id, date: d.date, createdAt: d.createdAt, currency: d.currency, entregaId: d.entregaId, pendiente: getDocumentEffect(d), soloContra: null }))
      .filter((d) => d.pendiente.greaterThan(0)),
    ...payments
      .filter((p) => p.concepto === "COBRO_PROVEEDOR" && p.amount.lessThan(0))
      .map((p) => ({ tipo: "COBRO" as const, id: p.id, date: p.date, createdAt: p.createdAt, currency: p.currency, entregaId: p.entregaId, pendiente: p.amount.negated(), soloContra: p.cobraDocumentoId })),
  ].sort(porFecha);

  type Credito = { tipo: "PAGO" | "DOC"; id: string; date: Date; createdAt: Date; currency: string; entregaId: string | null; monto: Prisma.Decimal };
  const creditos: Credito[] = [
    ...payments
      .filter((p) => p.amount.greaterThan(0))
      .map((p) => ({ tipo: "PAGO" as const, id: p.id, date: p.date, createdAt: p.createdAt, currency: p.currency, entregaId: p.entregaId, monto: p.amount })),
    ...documents
      .map((d) => ({ d, efecto: getDocumentEffect(d) }))
      .filter(({ efecto }) => efecto.lessThan(0))
      .map(({ d, efecto }) => ({ tipo: "DOC" as const, id: d.id, date: d.date, createdAt: d.createdAt, currency: d.currency, entregaId: d.entregaId, monto: efecto.negated() })),
  ].sort(porFecha);

  const pagos: { paymentId: string; documentId: string; amount: Prisma.Decimal }[] = [];
  const notas: { creditoId: string; documentId: string; amount: Prisma.Decimal }[] = [];

  // Primero, los cobros que dijeron qué venta pagan: esa venta es de ellos aunque haya deudas más
  // viejas que, por fecha, se la hubieran comido antes.
  const restaDe = new Map(creditos.map((c) => [c.id, c.monto]));
  for (const d of deudas) {
    if (d.tipo !== "COBRO" || !d.soloContra) continue;
    const venta = creditos.find((c) => c.id === d.soloContra && c.tipo === "DOC" && c.currency === d.currency);
    if (!venta) continue;
    const aplica = Prisma.Decimal.min(restaDe.get(venta.id)!, d.pendiente);
    if (aplica.lessThanOrEqualTo(0)) continue;
    restaDe.set(venta.id, restaDe.get(venta.id)!.minus(aplica));
    d.pendiente = d.pendiente.minus(aplica);
    pagos.push({ paymentId: d.id, documentId: venta.id, amount: aplica.negated() });
  }

  for (const c of creditos) {
    let resta = restaDe.get(c.id)!;
    for (const d of deudas) {
      if (resta.lessThanOrEqualTo(0)) break;
      if (d.pendiente.lessThanOrEqualTo(0) || d.currency !== c.currency || d.entregaId !== c.entregaId) continue;
      // Un cobro sólo lo cancela una venta (un comprobante), nunca otro pago; y si eligió cuál, ésa.
      if (d.tipo === "COBRO" && (c.tipo !== "DOC" || (d.soloContra && d.soloContra !== c.id))) continue;
      const aplica = Prisma.Decimal.min(resta, d.pendiente);
      d.pendiente = d.pendiente.minus(aplica);
      resta = resta.minus(aplica);
      if (d.tipo === "COBRO") pagos.push({ paymentId: d.id, documentId: c.id, amount: aplica.negated() });
      else if (c.tipo === "PAGO") pagos.push({ paymentId: c.id, documentId: d.id, amount: aplica });
      else notas.push({ creditoId: c.id, documentId: d.id, amount: aplica });
    }
  }

  const ids = documents.map((d) => d.id);
  await tx.paymentAllocation.deleteMany({
    where: { OR: [{ payment: { accountId } }, { documentId: { in: ids } }] },
  });
  await tx.creditAllocation.deleteMany({
    where: { OR: [{ creditoId: { in: ids } }, { documentId: { in: ids } }] },
  });
  if (pagos.length > 0) await tx.paymentAllocation.createMany({ data: pagos });
  if (notas.length > 0) await tx.creditAllocation.createMany({ data: notas });
}

/** Varias cuentas de una vez: las dos de un cliente, o la del cliente y la del proveedor. */
export async function reimputarCuentas(tx: Tx, accountIds: (string | null | undefined)[]) {
  for (const id of new Set(accountIds.filter((x): x is string => Boolean(x)))) {
    await reimputarCuenta(tx, id);
  }
}

/**
 * Al final de una acción: rehace las imputaciones de todas las cuentas de estos clientes o
 * proveedores. Es lo que hay que llamar después de cargar, editar o borrar cualquier cosa que
 * mueva una cuenta corriente — un comprobante, un pago, un saldo inicial.
 */
export async function reimputarEntidades(...entityIds: (string | null | undefined)[]) {
  const ids = [...new Set(entityIds.filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return;
  const cuentas = await prisma.account.findMany({ where: { entityId: { in: ids } }, select: { id: true } });
  await prisma.$transaction((tx) => reimputarCuentas(tx, cuentas.map((c) => c.id)), { timeout: 60_000 });
}
