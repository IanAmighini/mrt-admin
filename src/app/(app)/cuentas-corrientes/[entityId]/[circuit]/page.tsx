import Link from "next/link";
import { notFound } from "next/navigation";
import type { Circuit, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAccountDocuments, getDocumentEffect } from "@/lib/ledger";
import { getCurrentPricesForAccount } from "@/lib/pricing";
import { formatMoney, formatQuantity, sumDecimals, ZERO } from "@/lib/money";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatProductBrandLabel } from "@/lib/product-label";
import {
  deleteCompra,
  deleteDocument,
  deleteFactura,
  deletePayment,
  deleteRemito,
  moveRemitoToBlanco,
  updateCompra,
  updateDocument,
  updateFactura,
  updatePayment,
  updateRemito,
} from "../actions";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { RemitoFormFields } from "@/components/RemitoForm";
import { CompraFormFields } from "@/components/CompraForm";
import { EditFacturaFields } from "@/components/EditFacturaFields";
import { EditDocumentFields } from "@/components/EditDocumentFields";
import { EditPaymentFields } from "@/components/EditPaymentFields";

const CIRCUIT_BY_SLUG: Record<string, Circuit> = { blanco: "BLANCO", negro: "NEGRO" };

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type LedgerRow = {
  key: string;
  date: Date;
  title: string;
  subtitle: string | null;
  debe: Prisma.Decimal;
  haber: Prisma.Decimal;
  actions: React.ReactNode;
};

export default async function AccountLedgerPage({
  params,
}: {
  params: Promise<{ entityId: string; circuit: string }>;
}) {
  const { entityId, circuit: circuitSlug } = await params;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const circuit = CIRCUIT_BY_SLUG[circuitSlug];
  if (!circuit) notFound();

  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) notFound();

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
  });
  if (!account) notFound();

  const [documents, payments, products, items, blancoPrices, negroPrices] = await Promise.all([
    getAccountDocuments(account.id),
    prisma.payment.findMany({
      where: { accountId: account.id },
      include: { allocations: true },
      orderBy: { date: "asc" },
    }),
    prisma.product.findMany({
      orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
    }),
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    getCurrentPricesForAccount(entityId, "BLANCO"),
    getCurrentPricesForAccount(entityId, "NEGRO"),
  ]);

  const priceMapByCircuit: Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>> = {
    BLANCO: {},
    NEGRO: {},
  };
  for (const [productId, price] of blancoPrices) {
    priceMapByCircuit.BLANCO[productId] = { amount: price.amount.toNumber(), currency: price.currency };
  }
  for (const [productId, price] of negroPrices) {
    priceMapByCircuit.NEGRO[productId] = { amount: price.amount.toNumber(), currency: price.currency };
  }

  const rows: LedgerRow[] = [];

  for (const doc of documents) {
    const effect = getDocumentEffect(doc);
    const lineSummary =
      doc.lines.length > 0
        ? doc.lines.map((l) => {
            const perPallet = (l.product.boxesPerPallet ?? 0) * (l.product.unitsPerBox ?? 0);
            const priceLabel =
              perPallet > 0
                ? `${formatMoney(l.unitPrice.dividedBy(perPallet), doc.currency)}/bot.`
                : `${formatMoney(l.unitPrice, doc.currency)}/pallet`;
            return `${formatProductBrandLabel(l.product)} — ${l.product.presentation} — ${formatQuantity(l.quantity, "pallets")} — ${priceLabel}`;
          }).join(" · ")
        : doc.purchaseLines.length > 0
          ? doc.purchaseLines.map((l) => `${l.item.name} × ${formatQuantity(l.quantity)}`).join(" · ")
          : doc.reason;

    let actions: React.ReactNode = null;
    if (canEdit) {
      const headerDefaults = {
        number: doc.number,
        date: toDateInputValue(doc.date),
        dueDate: doc.dueDate ? toDateInputValue(doc.dueDate) : undefined,
        currency: doc.currency,
        exchangeRate: doc.exchangeRate?.toString(),
      };

      const moveToBlanco =
        circuit === "NEGRO" && doc.remitoLinks.length === 0 ? (
          <form action={moveRemitoToBlanco}>
            <input type="hidden" name="documentId" value={doc.id} />
            <button type="submit" className="text-xs underline underline-offset-2">
              Mover a Blanco
            </button>
          </form>
        ) : null;

      if (doc.lines.length > 0) {
        const defaultLines = doc.lines.map((l) => {
          const perPallet = (l.product.boxesPerPallet ?? 0) * (l.product.unitsPerBox ?? 0);
          const pricePerBottle = perPallet > 0 ? l.unitPrice.dividedBy(perPallet) : l.unitPrice;
          return {
            productId: l.productId,
            quantity: l.quantity.toString(),
            pricePerBottle: pricePerBottle.toString(),
            circuit,
          };
        });
        actions = (
          <div className="flex items-center gap-2">
            <FormModal triggerLabel="Editar" iconName="edit" title="Editar remito" action={updateRemito} maxWidthClass="max-w-2xl">
              <RemitoFormFields
                entityId={entityId}
                products={products}
                priceMapByCircuit={priceMapByCircuit}
                editingDocumentId={doc.id}
                defaultValues={headerDefaults}
                defaultLines={defaultLines}
              />
            </FormModal>
            <DeleteButton
              action={deleteRemito}
              hiddenName="documentId"
              hiddenValue={doc.id}
              confirmMessage="¿Borrar este remito? Esta acción no se puede deshacer."
            />
            {moveToBlanco}
          </div>
        );
      } else if (doc.purchaseLines.length > 0) {
        actions = (
          <div className="flex items-center gap-2">
            <FormModal triggerLabel="Editar" iconName="edit" title="Editar compra" action={updateCompra} maxWidthClass="max-w-2xl">
              <CompraFormFields
                entityId={entityId}
                items={items}
                editingDocumentId={doc.id}
                defaultValues={headerDefaults}
              />
            </FormModal>
            <DeleteButton
              action={deleteCompra}
              hiddenName="documentId"
              hiddenValue={doc.id}
              confirmMessage="¿Borrar esta compra? El stock que sumó se revierte. Esta acción no se puede deshacer."
            />
            {moveToBlanco}
          </div>
        );
      } else if (doc.type === "FACTURA") {
        actions = (
          <div className="flex items-center gap-2">
            <FormModal triggerLabel="Editar" iconName="edit" title="Editar factura" action={updateFactura}>
              <EditFacturaFields
                documentId={doc.id}
                defaultValues={{
                  ...headerDefaults,
                  netAmount: doc.netAmount.toString(),
                  ivaRate: doc.ivaRate?.toString(),
                  retentionAmount: doc.retentionAmount?.toString(),
                  perceptionAmount: doc.perceptionAmount?.toString(),
                }}
              />
            </FormModal>
            <DeleteButton
              action={deleteFactura}
              hiddenName="documentId"
              hiddenValue={doc.id}
              confirmMessage="¿Borrar esta factura? Los remitos vinculados vuelven a quedar pendientes de facturar."
            />
          </div>
        );
      } else {
        actions = (
          <div className="flex items-center gap-2">
            <FormModal triggerLabel="Editar" iconName="edit" title="Editar movimiento" action={updateDocument}>
              <EditDocumentFields
                documentId={doc.id}
                defaultValues={{
                  ...headerDefaults,
                  type: doc.type as "NOTA_CREDITO" | "NOTA_DEBITO" | "AJUSTE",
                  amount: doc.netAmount.toString(),
                  ajusteEffect: doc.totalAmount.lessThan(0) ? "RESTA" : "SUMA",
                  reason: doc.reason ?? undefined,
                }}
              />
            </FormModal>
            <DeleteButton
              action={deleteDocument}
              hiddenName="documentId"
              hiddenValue={doc.id}
              confirmMessage="¿Borrar este movimiento? Esta acción no se puede deshacer."
            />
          </div>
        );
      }
    }

    rows.push({
      key: `doc-${doc.id}`,
      date: doc.date,
      title: `${DOCUMENT_TYPE_LABELS[doc.type]} #${doc.number}`,
      subtitle: lineSummary,
      debe: effect.greaterThan(0) ? effect : ZERO,
      haber: effect.lessThan(0) ? effect.negated() : ZERO,
      actions,
    });
  }

  for (const payment of payments) {
    // El Haber es el monto total del pago (no solo la parte imputada a algún comprobante) — así
    // el saldo acumulado coincide con getAccountBalance, que resta el sobrante sin imputar como
    // crédito a favor del cliente en vez de "perderlo".
    const imputado = sumDecimals(payment.allocations.map((a) => a.amount));
    const sinImputar = payment.amount.minus(imputado);
    const subtitleParts = [
      payment.reference,
      sinImputar.greaterThan(0) ? `${formatMoney(sinImputar, payment.currency)} sin imputar` : null,
    ].filter(Boolean);

    rows.push({
      key: `pay-${payment.id}`,
      date: payment.date,
      title: `Pago — ${PAYMENT_METHOD_LABELS[payment.method]}`,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
      debe: ZERO,
      haber: payment.amount,
      actions: canEdit ? (
        <div className="flex items-center gap-2">
          <FormModal triggerLabel="Editar" iconName="edit" title="Editar pago" action={updatePayment}>
            <EditPaymentFields
              paymentId={payment.id}
              defaultValues={{
                circuit,
                method: payment.method,
                date: toDateInputValue(payment.date),
                amount: payment.amount.toString(),
                reference: payment.reference ?? undefined,
              }}
            />
          </FormModal>
          <DeleteButton
            action={deletePayment}
            hiddenName="paymentId"
            hiddenValue={payment.id}
            confirmMessage="¿Borrar este pago? Esta acción no se puede deshacer."
          />
        </div>
      ) : null,
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
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm text-foreground/60">Debe</p>
          <p className="text-lg font-semibold">{formatMoney(totalDebe)}</p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm text-foreground/60">Haber</p>
          <p className="text-lg font-semibold">{formatMoney(totalHaber)}</p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm text-foreground/60">Saldo</p>
          <p className="text-lg font-semibold">{formatMoney(saldoAcumulado)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Descripción</th>
              <th className="py-2 pr-4">Debe</th>
              <th className="py-2 pr-4">Haber</th>
              <th className="py-2 pr-4">Saldo Acum.</th>
              {canEdit && <th className="py-2 pr-4"></th>}
            </tr>
          </thead>
          <tbody>
            {rowsWithBalance
              .slice()
              .reverse()
              .map((row) => (
                <tr key={row.key} className="border-b border-foreground/5">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {row.date.toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-2 pr-4">
                    {row.title}
                    {row.subtitle && (
                      <p className="text-xs font-normal text-foreground/50">{row.subtitle}</p>
                    )}
                  </td>
                  <td className="py-2 pr-4">{row.debe.isZero() ? "—" : formatMoney(row.debe)}</td>
                  <td className="py-2 pr-4">{row.haber.isZero() ? "—" : formatMoney(row.haber)}</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(row.saldoAcumulado)}</td>
                  {canEdit && <td className="py-2 pr-4">{row.actions}</td>}
                </tr>
              ))}
            {rowsWithBalance.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="py-6 text-center text-foreground/40">
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
