import Link from "next/link";
import { notFound } from "next/navigation";
import type { Circuit, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAccountDocuments, getDocumentEffect } from "@/lib/ledger";
import { formatMoney, formatQuantity, sumDecimals, ZERO } from "@/lib/money";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";

const CIRCUIT_BY_SLUG: Record<string, Circuit> = { blanco: "BLANCO", negro: "NEGRO" };

type LedgerRow = {
  key: string;
  date: Date;
  title: string;
  subtitle: string | null;
  debe: Prisma.Decimal;
  haber: Prisma.Decimal;
};

export default async function AccountLedgerPage({
  params,
}: {
  params: Promise<{ entityId: string; circuit: string }>;
}) {
  const { entityId, circuit: circuitSlug } = await params;
  await requireUser();

  const circuit = CIRCUIT_BY_SLUG[circuitSlug];
  if (!circuit) notFound();

  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) notFound();

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
  });
  if (!account) notFound();

  const [documents, payments] = await Promise.all([
    getAccountDocuments(account.id),
    prisma.payment.findMany({
      where: { accountId: account.id },
      include: { allocations: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const rows: LedgerRow[] = [];

  for (const doc of documents) {
    const effect = getDocumentEffect(doc);
    const lineSummary =
      doc.lines.length > 0
        ? doc.lines.map((l) => `${l.product.name} × ${formatQuantity(l.quantity)}`).join(" · ")
        : doc.purchaseLines.length > 0
          ? doc.purchaseLines.map((l) => `${l.item.name} × ${formatQuantity(l.quantity)}`).join(" · ")
          : doc.reason;

    rows.push({
      key: `doc-${doc.id}`,
      date: doc.date,
      title: `${DOCUMENT_TYPE_LABELS[doc.type]} #${doc.number}`,
      subtitle: lineSummary,
      debe: effect.greaterThan(0) ? effect : ZERO,
      haber: effect.lessThan(0) ? effect.negated() : ZERO,
    });
  }

  for (const payment of payments) {
    // El saldo de la cuenta (getAccountBalance) solo se reduce por la parte de un pago que
    // efectivamente quedó imputada a algún comprobante — un pago sin imputar (o con sobrante sin
    // imputar) no afecta el saldo hoy, así que el libro mayor tiene que reflejar lo mismo para
    // no mostrar un saldo acumulado que no coincida con el de la tarjeta/ficha.
    const imputado = sumDecimals(payment.allocations.map((a) => a.amount));
    const sinImputar = payment.amount.minus(imputado);
    const subtitleParts = [payment.reference, sinImputar.greaterThan(0) ? `${formatMoney(sinImputar, payment.currency)} sin imputar` : null].filter(Boolean);

    rows.push({
      key: `pay-${payment.id}`,
      date: payment.date,
      title: `Pago — ${PAYMENT_METHOD_LABELS[payment.method]}`,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
      debe: ZERO,
      haber: imputado,
    });
  }

  rows.sort((a, b) => a.date.getTime() - b.date.getTime());

  let saldoAcumulado = ZERO;
  const rowsWithBalance = rows.map((row) => {
    saldoAcumulado = saldoAcumulado.plus(row.debe).minus(row.haber);
    return { ...row, saldoAcumulado };
  });

  const totalDebe = sumDecimals(rows.map((r) => r.debe));
  const totalHaber = sumDecimals(rows.map((r) => r.haber));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/cuentas-corrientes/${entityId}`}
          className="text-sm underline underline-offset-2"
        >
          ← Volver a {entity.name}
        </Link>
        <h1 className="text-xl font-semibold mt-2">
          {entity.name} — Cuenta {CIRCUIT_LABELS[circuit]}
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 max-w-xl">
        <div className="rounded-lg border border-black/10 p-4">
          <p className="text-sm text-black/60">Debe</p>
          <p className="text-lg font-semibold">{formatMoney(totalDebe)}</p>
        </div>
        <div className="rounded-lg border border-black/10 p-4">
          <p className="text-sm text-black/60">Haber</p>
          <p className="text-lg font-semibold">{formatMoney(totalHaber)}</p>
        </div>
        <div className="rounded-lg border border-black/10 p-4">
          <p className="text-sm text-black/60">Saldo</p>
          <p className="text-lg font-semibold">{formatMoney(saldoAcumulado)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-black/60">
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Descripción</th>
              <th className="py-2 pr-4">Debe</th>
              <th className="py-2 pr-4">Haber</th>
              <th className="py-2 pr-4">Saldo Acum.</th>
            </tr>
          </thead>
          <tbody>
            {rowsWithBalance
              .slice()
              .reverse()
              .map((row) => (
                <tr key={row.key} className="border-b border-black/5">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {row.date.toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-2 pr-4">
                    {row.title}
                    {row.subtitle && (
                      <p className="text-xs font-normal text-black/50">{row.subtitle}</p>
                    )}
                  </td>
                  <td className="py-2 pr-4">{row.debe.isZero() ? "—" : formatMoney(row.debe)}</td>
                  <td className="py-2 pr-4">{row.haber.isZero() ? "—" : formatMoney(row.haber)}</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(row.saldoAcumulado)}</td>
                </tr>
              ))}
            {rowsWithBalance.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-black/40">
                  Sin movimientos todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
