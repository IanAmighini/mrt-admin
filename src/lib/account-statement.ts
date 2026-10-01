import { UserError } from "@/lib/user-error";
import "server-only";
import { Prisma, type Account, type Currency, type Entity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatMoney, formatQuantity, sumDecimals, ZERO } from "@/lib/money";
import {
  CIRCUIT_LABELS,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  TREASURY_MOVEMENT_CATEGORY_LABELS,
} from "@/lib/labels";
import { formatProductBrandLabel } from "@/lib/product-label";
import { getAccountDocuments, getDocumentEffect, getTreasuries, type DocumentWithRelations } from "@/lib/ledger";
import { NUMERO_SALDO_INICIAL } from "@/lib/saldo-inicial";

export type StatementPayment = Prisma.PaymentGetPayload<{ include: { allocations: true } }>;
export type StatementLinkedPayment = Prisma.PaymentGetPayload<{
  include: { account: { include: { entity: true } } };
}>;

/** El origen de la fila, para que la pantalla arme sus botones de editar/borrar. El Excel lo ignora. */
export type StatementSource =
  | { kind: "document"; document: DocumentWithRelations }
  | { kind: "payment"; payment: StatementPayment; linkedPayment: StatementLinkedPayment | null };

export type StatementEntry = {
  key: string;
  date: Date;
  /** Cuándo se cargó en la app. Desempata a los que tienen la misma fecha: ver el orden de abajo. */
  cargadoEl: Date;
  /** El saldo inicial va siempre primero, pase lo que pase con su fecha. */
  esSaldoInicial: boolean;
  title: string;
  subtitle: string | null;
  currency: Currency;
  debe: Prisma.Decimal;
  haber: Prisma.Decimal;
  saldoAcumulado: Prisma.Decimal;
  source: StatementSource;
};

export type AccountStatement = {
  entity: Entity;
  account: Account;
  /** `to` es exclusivo, igual que en `Period`. `null` = sin límite por ese lado. */
  period: { from: Date | null; to: Date | null };
  saldoAnterior: Prisma.Decimal;
  /** Solo las del período, en orden ascendente por fecha. */
  entries: StatementEntry[];
  totalDebe: Prisma.Decimal;
  totalHaber: Prisma.Decimal;
  saldoFinal: Prisma.Decimal;
  /** Más de una ⇒ el saldo suma monedas distintas y hay que avisarlo. */
  currencies: Currency[];
  generatedAt: Date;
};

/** Solo lo que realmente lee, y no `DocumentWithRelations` entero: así sirve desde cualquier
 *  consulta que traiga las líneas, sin arrastrar el resto de las relaciones. */
export function documentSubtitle(
  doc: Pick<DocumentWithRelations, "lines" | "purchaseLines" | "reason" | "currency" | "treasuryCategory"> & {
    destinatario?: { nombre: string } | null;
    entrega?: { nombre: string } | null;
  }
): string | null {
  const lineSummary =
    doc.lines.length > 0
      ? doc.lines
          .map((l) => {
            const perPallet = (l.product.boxesPerPallet ?? 0) * (l.product.unitsPerBox ?? 0);
            const priceLabel =
              perPallet > 0
                ? `${formatMoney(l.unitPrice.dividedBy(perPallet), doc.currency)}/bot.`
                : `${formatMoney(l.unitPrice, doc.currency)}/pallet`;
            return `${formatProductBrandLabel(l.product)} — ${l.product.presentation} — ${formatQuantity(l.quantity, "pallets")} — ${priceLabel}`;
          })
          .join(" · ")
      : doc.purchaseLines.length > 0
        ? doc.purchaseLines.map((l) => `${l.item.name} × ${formatQuantity(l.quantity)}`).join(" · ")
        : doc.reason;

  const conCategoria =
    doc.treasuryCategory &&
    doc.treasuryCategory !== "COBRO" &&
    doc.treasuryCategory !== "PAGO_PROVEEDOR"
      ? [TREASURY_MOVEMENT_CATEGORY_LABELS[doc.treasuryCategory], lineSummary].filter(Boolean).join(" · ")
      : lineSummary;

  // El viaje y a nombre de quién salió van adelante: en una cuenta que trabaja por camiones, eso
  // es lo primero que se busca al leer una fila, antes que el detalle de lo entregado.
  const encabezado = [doc.entrega?.nombre, doc.destinatario?.nombre].filter(Boolean).join(" — ");
  return [encabezado || null, conCategoria].filter(Boolean).join(" · ") || null;
}

/**
 * Arma el estado de cuenta de una cuenta: documentos y pagos mezclados en orden cronológico, con
 * el debe/haber y el saldo acumulado. Lo consumen tanto la pantalla del libro mayor como el Excel.
 *
 * El saldo se acumula sobre TODOS los movimientos y recién después se recorta el período, así
 * `saldoAnterior + Σdebe − Σhaber = saldoFinal` se cumple por construcción. Sin `from`/`to` el
 * resultado es el historial completo, idéntico a lo que mostraba la página antes de extraer esto.
 */
export async function getAccountStatement({
  accountId,
  from = null,
  to = null,
}: {
  accountId: string;
  from?: Date | null;
  /** Exclusivo. */
  to?: Date | null;
}): Promise<AccountStatement> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { entity: true },
  });
  if (!account) throw new UserError("Cuenta inexistente.");

  const [documents, payments, treasuries] = await Promise.all([
    getAccountDocuments(accountId),
    prisma.payment.findMany({
      where: { accountId },
      include: { allocations: true },
      orderBy: { date: "asc" },
    }),
    getTreasuries(),
  ]);

  const linkedPaymentIds = payments.map((p) => p.linkedPaymentId).filter((id): id is string => !!id);
  const linkedPayments = linkedPaymentIds.length
    ? await prisma.payment.findMany({
        where: { id: { in: linkedPaymentIds } },
        include: { account: { include: { entity: true } } },
      })
    : [];
  const linkedPaymentById = new Map(linkedPayments.map((p) => [p.id, p]));
  const treasuryById = new Map(treasuries.map((t) => [t.id, t]));

  const all: Omit<StatementEntry, "saldoAcumulado">[] = [];

  for (const doc of documents) {
    const effect = getDocumentEffect(doc);
    all.push({
      key: `doc-${doc.id}`,
      date: doc.date,
      title: `${DOCUMENT_TYPE_LABELS[doc.type]} #${doc.number}`,
      subtitle: documentSubtitle(doc),
      currency: doc.currency,
      debe: effect.greaterThan(0) ? effect : ZERO,
      haber: effect.lessThan(0) ? effect.negated() : ZERO,
      cargadoEl: doc.createdAt,
      esSaldoInicial: doc.number === NUMERO_SALDO_INICIAL,
      source: { kind: "document", document: doc },
    });
  }

  for (const payment of payments) {
    // El Haber es el monto total del pago (no solo la parte imputada a algún comprobante) — así
    // el saldo acumulado coincide con getAccountBalance, que resta el sobrante sin imputar como
    // crédito a favor del cliente en vez de "perderlo".
    const imputado = sumDecimals(payment.allocations.map((a) => a.amount));
    const sinImputar = payment.amount.minus(imputado);
    const linkedPayment = payment.linkedPaymentId
      ? (linkedPaymentById.get(payment.linkedPaymentId) ?? null)
      : null;
    const destinoLabel = payment.treasuryId
      ? `→ ${treasuryById.get(payment.treasuryId)?.name ?? "tesorería"}`
      : linkedPayment
        ? // La cuenta del proveedor puede no ser esta: un cobro en negro cancela igual una factura
          // en blanco. Cuando cambia hay que decirlo, o el saldo del otro lado no se entiende.
          `→ directo a ${linkedPayment.account.entity.name}${
            linkedPayment.account.circuit === account.circuit
              ? ""
              : ` (${CIRCUIT_LABELS[linkedPayment.account.circuit]})`
          }`
        : null;
    const subtitleParts = [
      payment.reference,
      destinoLabel,
      sinImputar.greaterThan(0) ? `${formatMoney(sinImputar, payment.currency)} sin imputar` : null,
    ].filter(Boolean);

    all.push({
      key: `pay-${payment.id}`,
      date: payment.date,
      title: `Pago — ${PAYMENT_METHOD_LABELS[payment.method]}`,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
      currency: payment.currency,
      debe: ZERO,
      haber: payment.amount,
      cargadoEl: payment.createdAt,
      esSaldoInicial: false,
      source: { kind: "payment", payment, linkedPayment },
    });
  }

  // El orden tiene tres niveles, y los tres importan:
  //
  // 1. **El saldo inicial va primero**, aunque su fecha sea posterior a algún movimiento. Es "todo
  //    lo anterior a esta cuenta", no un movimiento más: si quedó en el medio, el saldo acumulado
  //    arranca desde cero y la caja aparece en rojo hasta que le toca el turno.
  // 2. La fecha del comprobante, que es lo que mira cualquiera.
  // 3. **Cuándo se cargó**, para los del mismo día. Dos pagos del 30 cargados en distinto momento
  //    tienen que acumularse en el orden en que se registraron; sin esto el desempate lo decidía
  //    la base y el saldo de la fila cambiaba de una consulta a otra.
  all.sort((a, b) => {
    if (a.esSaldoInicial !== b.esSaldoInicial) return a.esSaldoInicial ? -1 : 1;
    const porFecha = a.date.getTime() - b.date.getTime();
    if (porFecha !== 0) return porFecha;
    return a.cargadoEl.getTime() - b.cargadoEl.getTime();
  });

  let saldo = ZERO;
  const withBalance: StatementEntry[] = all.map((entry) => {
    saldo = saldo.plus(entry.debe).minus(entry.haber);
    return { ...entry, saldoAcumulado: saldo };
  });

  let saldoAnterior = ZERO;
  const entries: StatementEntry[] = [];
  for (const entry of withBalance) {
    if (from && entry.date < from) {
      saldoAnterior = entry.saldoAcumulado;
      continue;
    }
    if (to && entry.date >= to) continue;
    entries.push(entry);
  }

  const totalDebe = sumDecimals(entries.map((e) => e.debe));
  const totalHaber = sumDecimals(entries.map((e) => e.haber));
  const saldoFinal = entries.length > 0 ? entries[entries.length - 1].saldoAcumulado : saldoAnterior;

  const { entity, ...accountOnly } = account;

  return {
    entity,
    account: accountOnly,
    period: { from, to },
    saldoAnterior,
    entries,
    totalDebe,
    totalHaber,
    saldoFinal,
    currencies: Array.from(new Set(entries.map((e) => e.currency))),
    generatedAt: new Date(),
  };
}
