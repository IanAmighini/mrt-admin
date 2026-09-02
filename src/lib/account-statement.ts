import "server-only";
import { Prisma, type Account, type Currency, type Entity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatMoney, formatQuantity, sumDecimals, ZERO } from "@/lib/money";
import { DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS, TREASURY_MOVEMENT_CATEGORY_LABELS } from "@/lib/labels";
import { formatProductBrandLabel } from "@/lib/product-label";
import { getAccountDocuments, getDocumentEffect, getTreasuries, type DocumentWithRelations } from "@/lib/ledger";

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

function documentSubtitle(doc: DocumentWithRelations): string | null {
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

  return doc.treasuryCategory &&
    doc.treasuryCategory !== "COBRO" &&
    doc.treasuryCategory !== "PAGO_PROVEEDOR"
    ? [TREASURY_MOVEMENT_CATEGORY_LABELS[doc.treasuryCategory], lineSummary].filter(Boolean).join(" · ")
    : lineSummary;
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
  if (!account) throw new Error("Cuenta inexistente.");

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
        ? `→ directo a ${linkedPayment.account.entity.name}`
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
      source: { kind: "payment", payment, linkedPayment },
    });
  }

  all.sort((a, b) => a.date.getTime() - b.date.getTime());

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
