import Link from "next/link";
import { notFound } from "next/navigation";
import type { Account, Entity, Product } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import {
  getAccountBalance,
  getAccountDocuments,
  getDocumentEffect,
  getDocumentPending,
  getInvoiceableRemitos,
} from "@/lib/ledger";
import { getCurrentPricesForAccount, getPriceHistory } from "@/lib/pricing";
import { DEFAULT_IVA_RATE, formatMoney, formatQuantity, sumDecimals, ZERO } from "@/lib/money";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import {
  createDocument,
  createFactura,
  createPayment,
  createPrice,
  createRemito,
  moveRemitoToBlanco,
} from "./actions";
import { RemitoLinesFields } from "./RemitoLinesFields";

export default async function EntityLedgerPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    include: { accounts: true },
  });
  if (!entity) notFound();

  const blancoAccount = entity.accounts.find((a) => a.circuit === "BLANCO");
  const negroAccount = entity.accounts.find((a) => a.circuit === "NEGRO");
  if (!blancoAccount || !negroAccount) notFound();

  const [products, blancoPrices, negroPrices] = await Promise.all([
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    getCurrentPricesForAccount(entity.id, "BLANCO"),
    getCurrentPricesForAccount(entity.id, "NEGRO"),
  ]);

  const priceMapByCircuit: Record<
    "BLANCO" | "NEGRO",
    Record<string, { amount: number; currency: string }>
  > = { BLANCO: {}, NEGRO: {} };
  for (const [productId, price] of blancoPrices) {
    priceMapByCircuit.BLANCO[productId] = { amount: price.amount.toNumber(), currency: price.currency };
  }
  for (const [productId, price] of negroPrices) {
    priceMapByCircuit.NEGRO[productId] = { amount: price.amount.toNumber(), currency: price.currency };
  }

  return (
    <div className="space-y-10">
      <div>
        <Link href="/cuentas-corrientes" className="text-sm underline underline-offset-2">
          ← Cuentas corrientes
        </Link>
        <h1 className="text-xl font-semibold mt-2">{entity.name}</h1>
      </div>

      {canEdit && (
        <NewRemitoForm entityId={entity.id} products={products} priceMapByCircuit={priceMapByCircuit} />
      )}

      <CircuitPanel entity={entity} account={blancoAccount} products={products} canEdit={canEdit} />
      <CircuitPanel entity={entity} account={negroAccount} products={products} canEdit={canEdit} />
    </div>
  );
}

function NewRemitoForm({
  entityId,
  products,
  priceMapByCircuit,
}: {
  entityId: string;
  products: Product[];
  priceMapByCircuit: Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>>;
}) {
  return (
    <form action={createRemito} className="space-y-4 rounded-lg border border-black/10 p-4">
      <h2 className="text-sm font-semibold">Nuevo remito</h2>
      <p className="text-xs text-black/50">
        Un mismo remito puede tener líneas facturadas (van a Blanco) y sin facturar (van a Negro)
        — se cargan las dos cuentas del cliente automáticamente según lo que elijas por línea.
      </p>
      <input type="hidden" name="entityId" value={entityId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Número">
          <input name="number" required className={inputClass} />
        </Field>
        <Field label="Fecha">
          <input type="date" name="date" required className={inputClass} />
        </Field>
        <Field label="Vencimiento (opcional)">
          <input type="date" name="dueDate" className={inputClass} />
        </Field>
        <Field label="Moneda">
          <select name="currency" defaultValue="ARS" className={selectClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Cotización (si es USD)">
          <input name="exchangeRate" className={inputClass} />
        </Field>
      </div>
      <RemitoLinesFields
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          boxesPerPallet: p.boxesPerPallet,
          unitsPerBox: p.unitsPerBox,
        }))}
        priceMapByCircuit={priceMapByCircuit}
      />
      <button type="submit" className={submitClass}>
        Crear remito
      </button>
    </form>
  );
}

async function CircuitPanel({
  entity,
  account,
  products,
  canEdit,
}: {
  entity: Entity;
  account: Account;
  products: Product[];
  canEdit: boolean;
}) {
  const [balance, documents, payments, invoiceableRemitos, currentPrices, priceHistory] =
    await Promise.all([
      getAccountBalance(account.id),
      getAccountDocuments(account.id),
      prisma.payment.findMany({
        where: { accountId: account.id },
        include: { allocations: { include: { document: true } } },
        orderBy: { date: "desc" },
      }),
      account.circuit === "BLANCO" ? getInvoiceableRemitos(account.id) : Promise.resolve([]),
      getCurrentPricesForAccount(entity.id, account.circuit),
      getPriceHistory(entity.id, account.circuit),
    ]);

  const today = new Date();
  const documentsDesc = documents.slice().reverse();

  return (
    <section className="space-y-6 rounded-lg border border-black/10 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Circuito {CIRCUIT_LABELS[account.circuit]}</h2>
        <p className="text-lg font-semibold">{formatMoney(balance)}</p>
      </div>

      {canEdit && (
        <div className="grid gap-6 lg:grid-cols-2">
          <NewDocumentForm accountId={account.id} />
          {account.circuit === "BLANCO" && (
            <NewFacturaForm
              accountId={account.id}
              entity={entity}
              invoiceableRemitos={invoiceableRemitos}
            />
          )}
          <NewPaymentForm accountId={account.id} pendingDocuments={documents} />
        </div>
      )}

      <PricesSection
        entityId={entity.id}
        circuit={account.circuit}
        products={products}
        currentPrices={currentPrices}
        priceHistory={priceHistory}
        canEdit={canEdit}
      />

      <div>
        <h3 className="text-sm font-semibold mb-2">Comprobantes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2 pr-4">Número</th>
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Vencimiento</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2 pr-4">Pendiente</th>
                <th className="py-2 pr-4">Estado</th>
                {canEdit && account.circuit === "NEGRO" && <th className="py-2 pr-4"></th>}
              </tr>
            </thead>
            <tbody>
              {documentsDesc.map((doc) => {
                const pending = getDocumentPending(doc);
                const vencido = doc.dueDate && doc.dueDate < today && pending.greaterThan(0);
                const invoicedAmount =
                  doc.type === "REMITO" ? sumDecimals(doc.remitoLinks.map((l) => l.amount)) : ZERO;
                const isPartiallyInvoiced =
                  doc.type === "REMITO" && invoicedAmount.greaterThan(0) && getDocumentEffect(doc).greaterThan(0);
                const isFullyInvoiced =
                  doc.type === "REMITO" && invoicedAmount.greaterThan(0) && getDocumentEffect(doc).lessThanOrEqualTo(0);
                const status = isFullyInvoiced
                  ? "Facturado"
                  : isPartiallyInvoiced
                    ? "Parcialmente facturado"
                    : pending.lessThanOrEqualTo(0)
                      ? "Saldado"
                      : vencido
                        ? "Vencido"
                        : "Pendiente";

                return (
                  <tr key={doc.id} className="border-b border-black/5">
                    <td className="py-2 pr-4">{DOCUMENT_TYPE_LABELS[doc.type]}</td>
                    <td className="py-2 pr-4">
                      {doc.number}
                      {doc.lines.length > 0 && (
                        <p className="text-xs font-normal text-black/50">
                          {doc.lines
                            .map((l) => `${l.product.name} × ${formatQuantity(l.quantity)}`)
                            .join(" · ")}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-4">{doc.date.toLocaleDateString("es-AR")}</td>
                    <td className="py-2 pr-4">{doc.dueDate?.toLocaleDateString("es-AR") ?? "—"}</td>
                    <td className="py-2 pr-4">{formatMoney(doc.totalAmount, doc.currency)}</td>
                    <td className="py-2 pr-4">{formatMoney(pending, doc.currency)}</td>
                    <td className="py-2 pr-4">
                      <span className={vencido ? "text-red-600 font-medium" : "text-black/60"}>
                        {status}
                      </span>
                    </td>
                    {canEdit && account.circuit === "NEGRO" && (
                      <td className="py-2 pr-4">
                        {doc.type === "REMITO" && doc.remitoLinks.length === 0 && (
                          <form action={moveRemitoToBlanco}>
                            <input type="hidden" name="documentId" value={doc.id} />
                            <button type="submit" className="text-xs underline underline-offset-2">
                              Mover a Blanco
                            </button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {documentsDesc.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-black/40">
                    Sin comprobantes todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Pagos</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Monto</th>
                <th className="py-2 pr-4">Medio</th>
                <th className="py-2 pr-4">Referencia</th>
                <th className="py-2 pr-4">Imputado a</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">{payment.date.toLocaleDateString("es-AR")}</td>
                  <td className="py-2 pr-4">{formatMoney(payment.amount, payment.currency)}</td>
                  <td className="py-2 pr-4">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                  <td className="py-2 pr-4">{payment.reference ?? "—"}</td>
                  <td className="py-2 pr-4">
                    {payment.allocations.length === 0
                      ? "Sin imputar"
                      : payment.allocations
                          .map((a) => `${DOCUMENT_TYPE_LABELS[a.document.type]} #${a.document.number}`)
                          .join(", ")}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-black/40">
                    Sin pagos todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function NewDocumentForm({ accountId }: { accountId: string }) {
  return (
    <form action={createDocument} className="space-y-3 rounded-lg border border-black/10 p-4">
      <h3 className="text-sm font-semibold">Nota / ajuste</h3>
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <select name="type" required defaultValue="NOTA_CREDITO" className={selectClass}>
            <option value="NOTA_CREDITO">Nota de crédito</option>
            <option value="NOTA_DEBITO">Nota de débito</option>
            <option value="AJUSTE">Ajuste manual</option>
          </select>
        </Field>
        <Field label="Número">
          <input name="number" required className={inputClass} />
        </Field>
        <Field label="Fecha">
          <input type="date" name="date" required className={inputClass} />
        </Field>
        <Field label="Vencimiento (opcional)">
          <input type="date" name="dueDate" className={inputClass} />
        </Field>
        <Field label="Moneda">
          <select name="currency" defaultValue="ARS" className={selectClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Cotización (si es USD)">
          <input name="exchangeRate" className={inputClass} />
        </Field>
        <Field label="Monto">
          <input name="amount" required inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="Efecto (solo Ajuste)">
          <select name="ajusteEffect" defaultValue="SUMA" className={selectClass}>
            <option value="SUMA">Suma al saldo</option>
            <option value="RESTA">Resta al saldo</option>
          </select>
        </Field>
      </div>
      <Field label="Motivo (obligatorio para Ajuste)">
        <input name="reason" className={inputClass} />
      </Field>
      <button type="submit" className={submitClass}>
        Crear
      </button>
    </form>
  );
}

function NewFacturaForm({
  accountId,
  entity,
  invoiceableRemitos,
}: {
  accountId: string;
  entity: Entity;
  invoiceableRemitos: Awaited<ReturnType<typeof getInvoiceableRemitos>>;
}) {
  return (
    <form action={createFactura} className="space-y-3 rounded-lg border border-black/10 p-4">
      <h3 className="text-sm font-semibold">Nueva factura</h3>
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Número">
          <input name="number" required className={inputClass} />
        </Field>
        <Field label="Fecha">
          <input type="date" name="date" required className={inputClass} />
        </Field>
        <Field label="Vencimiento (opcional)">
          <input type="date" name="dueDate" className={inputClass} />
        </Field>
        <Field label="Moneda">
          <select name="currency" defaultValue="ARS" className={selectClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Cotización (si es USD)">
          <input name="exchangeRate" className={inputClass} />
        </Field>
        <Field label="Neto">
          <input name="netAmount" required inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="Alícuota IVA %">
          <input name="ivaRate" defaultValue={DEFAULT_IVA_RATE} className={inputClass} />
        </Field>
        {entity.isWithholdingAgent && (
          <>
            <Field label="Retención">
              <input name="retentionAmount" className={inputClass} />
            </Field>
            <Field label="Percepción">
              <input name="perceptionAmount" className={inputClass} />
            </Field>
          </>
        )}
      </div>
      {invoiceableRemitos.length > 0 && (
        <div>
          <p className="mb-1 text-sm">
            Remitos a incluir (opcional) — precargado con el pendiente, se puede bajar para
            facturar solo una parte
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {invoiceableRemitos.map((remito) => (
              <div key={remito.id} className="flex items-center gap-2 text-sm">
                <input type="hidden" name="remitoId" value={remito.id} />
                <span className="flex-1">
                  Remito #{remito.number} — pendiente {formatMoney(remito.pending, remito.currency)}
                </span>
                <input
                  name="remitoAmount"
                  placeholder="0.00"
                  inputMode="decimal"
                  defaultValue={remito.pending.toFixed(2)}
                  className="w-24 rounded border border-black/20 px-2 py-1 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <button type="submit" className={submitClass}>
        Crear factura
      </button>
    </form>
  );
}

function NewPaymentForm({
  accountId,
  pendingDocuments,
}: {
  accountId: string;
  pendingDocuments: Awaited<ReturnType<typeof getAccountDocuments>>;
}) {
  const pending = pendingDocuments
    .map((doc) => ({ doc, amount: getDocumentPending(doc) }))
    .filter((d) => d.amount.greaterThan(0));

  return (
    <form action={createPayment} className="space-y-3 rounded-lg border border-black/10 p-4">
      <h3 className="text-sm font-semibold">Nuevo pago / cobro</h3>
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha">
          <input type="date" name="date" required className={inputClass} />
        </Field>
        <Field label="Monto">
          <input name="amount" required inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="Moneda">
          <select name="currency" defaultValue="ARS" className={selectClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Forma de pago">
          <select name="method" defaultValue="EFECTIVO" className={selectClass}>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="CHEQUE">Cheque</option>
            <option value="OTRO">Otro</option>
          </select>
        </Field>
      </div>
      <Field label="N° de cheque / comprobante (si aplica)">
        <input name="reference" className={inputClass} />
      </Field>
      <fieldset className="space-y-1">
        <legend className="text-sm mb-1">Imputación</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="allocationMode" value="fifo" defaultChecked />
          Automática (FIFO — al comprobante pendiente más antiguo)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="allocationMode" value="manual" />
          Manual — elegir comprobante(s) y monto
        </label>
      </fieldset>
      {pending.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {pending.map(({ doc, amount }) => (
            <div key={doc.id} className="flex items-center gap-2 text-sm">
              <input type="hidden" name="manualDocumentId" value={doc.id} />
              <span className="flex-1">
                {DOCUMENT_TYPE_LABELS[doc.type]} #{doc.number} — pendiente{" "}
                {formatMoney(amount, doc.currency)}
              </span>
              <input
                name="manualAmount"
                placeholder="0.00"
                inputMode="decimal"
                className="w-24 rounded border border-black/20 px-2 py-1 text-xs"
              />
            </div>
          ))}
        </div>
      )}
      <button type="submit" className={submitClass}>
        Registrar pago
      </button>
    </form>
  );
}

function PricesSection({
  entityId,
  circuit,
  products,
  currentPrices,
  priceHistory,
  canEdit,
}: {
  entityId: string;
  circuit: Account["circuit"];
  products: Product[];
  currentPrices: Awaited<ReturnType<typeof getCurrentPricesForAccount>>;
  priceHistory: Awaited<ReturnType<typeof getPriceHistory>>;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Precios</h3>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-black/60">
              <th className="py-2 pr-4">Producto</th>
              <th className="py-2 pr-4">Precio vigente</th>
              <th className="py-2 pr-4">Vigente desde</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const price = currentPrices.get(product.id);
              return (
                <tr key={product.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">{product.name}</td>
                  <td className="py-2 pr-4">
                    {price ? formatMoney(price.amount, price.currency) : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {price ? price.validFrom.toLocaleDateString("es-AR") : "—"}
                  </td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-black/40">
                  No hay productos cargados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form action={createPrice} className="space-y-3 rounded-lg border border-black/10 p-4">
          <h4 className="text-sm font-semibold">Cargar precio</h4>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="circuit" value={circuit} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Producto">
              <select name="productId" required className={selectClass}>
                <option value="">Elegir…</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Precio">
              <input name="amount" required inputMode="decimal" className={inputClass} />
            </Field>
            <Field label="Moneda">
              <select name="currency" defaultValue="ARS" className={selectClass}>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Vigente desde">
              <input type="date" name="validFrom" required className={inputClass} />
            </Field>
          </div>
          <button type="submit" className={submitClass}>
            Guardar precio
          </button>
        </form>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium">Historial de precios</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Producto</th>
                <th className="py-2 pr-4">Precio</th>
                <th className="py-2 pr-4">Vigente desde</th>
                <th className="py-2 pr-4">Cargado por</th>
              </tr>
            </thead>
            <tbody>
              {priceHistory.map((price) => (
                <tr key={price.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">{price.product.name}</td>
                  <td className="py-2 pr-4">{formatMoney(price.amount, price.currency)}</td>
                  <td className="py-2 pr-4">{price.validFrom.toLocaleDateString("es-AR")}</td>
                  <td className="py-2 pr-4">{price.createdBy.name}</td>
                </tr>
              ))}
              {priceHistory.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-black/40">
                    Sin precios cargados todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full rounded border border-black/20 px-3 py-2 text-sm";
const selectClass = inputClass;
const submitClass =
  "w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover";
