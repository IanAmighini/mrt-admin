import Link from "next/link";
import { Download } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { findBySlugOrId } from "@/lib/slug-lookup";
import { getTreasuries } from "@/lib/ledger";
import { getAccountStatement, type StatementEntry } from "@/lib/account-statement";
import { getCurrentPricesForAccount } from "@/lib/pricing";
import { formatMoney } from "@/lib/money";
import { CIRCUIT_BY_SLUG, CIRCUIT_LABELS } from "@/lib/labels";
import {
  createDocumentForEntity,
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
import { DocumentFormFields } from "@/components/DocumentFormFields";
import { PROVEEDOR_DIRECTO_VALUE } from "@/lib/payment-destino";
import { addDays, toDateInputValue } from "@/lib/period";

const inputClass =
  "rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string; circuit: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { entityId: entityParam, circuit: circuitSlug } = await params;
  const { from, to } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const circuit = CIRCUIT_BY_SLUG[circuitSlug];
  if (!circuit) notFound();

  const entity = await findBySlugOrId(
    () => prisma.entity.findUnique({ where: { slug: entityParam } }),
    (id) => prisma.entity.findUnique({ where: { id } }),
    entityParam
  );
  if (!entity) notFound();
  if (entityParam !== entity.slug) redirect(`/cuentas-corrientes/${entity.slug}/${circuitSlug}`);
  const entityId = entity.id;

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId, circuit } },
  });
  if (!account) notFound();

  const isTreasuryEntity = entity.type === "TESORERIA";
  const isClienteEntity = entity.type !== "PROVEEDOR" && entity.type !== "TESORERIA";

  // El "hasta" que elige el usuario es inclusivo; getAccountStatement lo espera exclusivo.
  const fromDate = from ? new Date(`${from}T00:00:00`) : null;
  const toDate = to ? addDays(new Date(`${to}T00:00:00`), 1) : null;

  const [statement, products, items, blancoPrices, negroPrices, treasuries, proveedores] =
    await Promise.all([
      getAccountStatement({ accountId: account.id, from: fromDate, to: toDate }),
      prisma.product.findMany({
        orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
      }),
      prisma.item.findMany({ orderBy: { name: "asc" } }),
      getCurrentPricesForAccount(entityId, "BLANCO"),
      getCurrentPricesForAccount(entityId, "NEGRO"),
      isTreasuryEntity ? Promise.resolve([]) : getTreasuries(),
      isClienteEntity
        ? prisma.entity.findMany({ where: { type: { in: ["PROVEEDOR", "AMBOS"] } }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
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

  function renderActions(entry: StatementEntry): React.ReactNode {
    if (!canEdit) return null;

    if (entry.source.kind === "payment") {
      const { payment, linkedPayment } = entry.source;
      const defaultDestino = payment.treasuryId ?? (linkedPayment ? PROVEEDOR_DIRECTO_VALUE : "");
      return (
        <div className="flex items-center gap-2">
          <FormModal triggerLabel="Editar" iconName="edit" title="Editar pago" action={updatePayment}>
            <EditPaymentFields
              paymentId={payment.id}
              treasuries={treasuries}
              proveedores={isClienteEntity ? proveedores : undefined}
              defaultValues={{
                circuit,
                method: payment.method,
                date: toDateInputValue(payment.date),
                amount: payment.amount.toString(),
                reference: payment.reference ?? undefined,
                destino: defaultDestino,
                proveedorId: linkedPayment?.account.entityId,
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
      );
    }

    const doc = entry.source.document;
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
      return (
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
    }

    if (doc.purchaseLines.length > 0) {
      return (
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
    }

    if (doc.type === "FACTURA") {
      return (
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
    }

    return (
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

  const exportQuery = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const exportHref = `/cuentas-corrientes/${entity.slug}/${circuitSlug}/export${exportQuery ? `?${exportQuery}` : ""}`;
  const hasFilter = Boolean(fromDate || toDate);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={isTreasuryEntity ? "/tesoreria" : `/cuentas-corrientes/${entity.slug}`}
            className="text-sm underline underline-offset-2"
          >
            ← Volver a {isTreasuryEntity ? "Tesorería" : entity.name}
          </Link>
          <h1 className="text-xl font-semibold mt-2">
            {entity.name} — Cuenta {CIRCUIT_LABELS[circuit]}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isTreasuryEntity && canEdit && (
            <FormModal triggerLabel="Movimiento" title="Nuevo movimiento" action={createDocumentForEntity}>
              <DocumentFormFields fixedEntityId={entityId} isTreasury />
            </FormModal>
          )}
          <a
            href={exportHref}
            className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            <Download size={16} />
            Descargar Excel
          </a>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="from">
            Desde
          </label>
          <input id="from" type="date" name="from" defaultValue={from} className={`block ${inputClass}`} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="to">
            Hasta
          </label>
          <input id="to" type="date" name="to" defaultValue={to} className={`block ${inputClass}`} />
        </div>
        <button type="submit" className={`${inputClass} hover:bg-foreground/5`}>
          Filtrar
        </button>
        {hasFilter && (
          <Link
            href={`/cuentas-corrientes/${entity.slug}/${circuitSlug}`}
            className="px-2 py-2 text-sm text-foreground/60 underline underline-offset-2"
          >
            Ver todo
          </Link>
        )}
      </form>

      <div className="grid gap-4 sm:grid-cols-4 max-w-3xl">
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm text-foreground/60">Saldo anterior</p>
          <p className="text-lg font-semibold">{formatMoney(statement.saldoAnterior)}</p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm text-foreground/60">Debe</p>
          <p className="text-lg font-semibold">{formatMoney(statement.totalDebe)}</p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm text-foreground/60">Haber</p>
          <p className="text-lg font-semibold">{formatMoney(statement.totalHaber)}</p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm text-foreground/60">Saldo</p>
          <p className="text-lg font-semibold">{formatMoney(statement.saldoFinal)}</p>
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
            {statement.entries
              .slice()
              .reverse()
              .map((entry) => (
                <tr key={entry.key} className="border-b border-foreground/5">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {entry.date.toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-2 pr-4">
                    {entry.title}
                    {entry.subtitle && (
                      <p className="text-xs font-normal text-foreground/50">{entry.subtitle}</p>
                    )}
                  </td>
                  <td className="py-2 pr-4">{entry.debe.isZero() ? "—" : formatMoney(entry.debe)}</td>
                  <td className="py-2 pr-4">{entry.haber.isZero() ? "—" : formatMoney(entry.haber)}</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(entry.saldoAcumulado)}</td>
                  {canEdit && <td className="py-2 pr-4">{renderActions(entry)}</td>}
                </tr>
              ))}
            {fromDate && (
              <tr className="border-b border-foreground/5 bg-foreground/[0.02] font-medium">
                <td className="py-2 pr-4 whitespace-nowrap">{fromDate.toLocaleDateString("es-AR")}</td>
                <td className="py-2 pr-4">Saldo anterior</td>
                <td className="py-2 pr-4">—</td>
                <td className="py-2 pr-4">—</td>
                <td className="py-2 pr-4">{formatMoney(statement.saldoAnterior)}</td>
                {canEdit && <td className="py-2 pr-4"></td>}
              </tr>
            )}
            {statement.entries.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="py-6 text-center text-foreground/40">
                  {hasFilter ? "Sin movimientos en este período." : "Sin movimientos todavía."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
