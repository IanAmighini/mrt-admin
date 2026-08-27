import Link from "next/link";
import { notFound } from "next/navigation";
import type { Account, Entity, Product } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import {
  getAccountBalance,
  getAccountDocuments,
  getComprasSummary,
  getDocumentEffect,
  getDocumentPending,
  getEntregasCount,
  getInvoiceableRemitos,
  getLitrosEntregados,
  getRecentCompras,
  getRecentMovementsForEntity,
  getRecentRemitos,
} from "@/lib/ledger";
import { getCurrentPricesForAccount, getPriceHistory } from "@/lib/pricing";
import { DEFAULT_IVA_RATE, formatMoney, formatQuantity, sumDecimals, ZERO } from "@/lib/money";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { createDocument, createFactura, createPrice, moveRemitoToBlanco } from "./actions";
import { updateEntity } from "@/app/(app)/clientes/actions";
import { PaymentForm } from "@/components/PaymentForm";
import { FormModal } from "@/components/Modal";
import { EntityFormFields } from "@/components/EntityFormFields";
import { EntitySummaryCards } from "@/components/EntitySummaryCards";
import { EntregasPanel } from "@/components/EntregasPanel";
import { ComprasPanel } from "@/components/ComprasPanel";
import { CuentaCorrientePanel } from "@/components/CuentaCorrientePanel";

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

  const [products, items, blancoPrices, negroPrices, blancoSaldo, negroSaldo, recentMovements] =
    await Promise.all([
      prisma.product.findMany({ orderBy: { name: "asc" } }),
      prisma.item.findMany({ orderBy: { name: "asc" } }),
      getCurrentPricesForAccount(entity.id, "BLANCO"),
      getCurrentPricesForAccount(entity.id, "NEGRO"),
      getAccountBalance(blancoAccount.id),
      getAccountBalance(negroAccount.id),
      getRecentMovementsForEntity(entity.id, 8),
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

  const isCliente = entity.type !== "PROVEEDOR";
  const isProveedor = entity.type !== "CLIENTE";

  let card3Label = "Entregas";
  let card3Value = "0";
  let card4Label = "Litros entregados";
  let card4Value = "0";

  if (entity.type === "CLIENTE") {
    const [entregasCount, litros] = await Promise.all([
      getEntregasCount(entity.id),
      getLitrosEntregados(entity.id),
    ]);
    card3Value = String(entregasCount);
    card4Value = formatQuantity(litros, "L");
  } else if (entity.type === "PROVEEDOR") {
    const compras = await getComprasSummary(entity.id);
    card3Label = "Compras";
    card3Value = String(compras.count);
    card4Label = "Insumo entregado";
    card4Value =
      compras.totalByUnit.size === 1
        ? formatQuantity(
            Array.from(compras.totalByUnit.values())[0],
            Array.from(compras.totalByUnit.keys())[0]
          )
        : String(compras.count);
  } else {
    const [entregasCount, compras] = await Promise.all([
      getEntregasCount(entity.id),
      getComprasSummary(entity.id),
    ]);
    card3Label = "Entregas";
    card3Value = String(entregasCount);
    card4Label = "Compras";
    card4Value = String(compras.count);
  }

  const [recentRemitos, recentCompras] = await Promise.all([
    isCliente ? getRecentRemitos(5, entity.id) : Promise.resolve([]),
    isProveedor ? getRecentCompras(5, entity.id) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={entity.type === "PROVEEDOR" ? "/proveedores" : "/clientes"}
            className="text-sm underline underline-offset-2"
          >
            ← {entity.type === "PROVEEDOR" ? "Proveedores" : "Clientes"}
          </Link>
          <h1 className="text-xl font-semibold mt-2">{entity.name}</h1>
        </div>
        {canEdit && (
          <FormModal triggerLabel="Editar" title="Editar cliente/proveedor" action={updateEntity}>
            <EntityFormFields
              defaultType={entity.type === "PROVEEDOR" ? "PROVEEDOR" : "CLIENTE"}
              showSupplierCategory={entity.type !== "CLIENTE"}
              entity={entity}
            />
          </FormModal>
        )}
      </div>

      <EntitySummaryCards
        entityId={entity.id}
        blancoSaldo={blancoSaldo}
        negroSaldo={negroSaldo}
        card3Label={card3Label}
        card3Value={card3Value}
        card4Label={card4Label}
        card4Value={card4Value}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {isCliente && (
            <EntregasPanel
              entityId={entity.id}
              products={products}
              priceMapByCircuit={priceMapByCircuit}
              remitos={recentRemitos}
              canEdit={canEdit}
            />
          )}
          {isProveedor && (
            <ComprasPanel entityId={entity.id} items={items} compras={recentCompras} canEdit={canEdit} />
          )}
        </div>
        <CuentaCorrientePanel entityId={entity.id} movements={recentMovements} canEdit={canEdit} />
      </div>

      <CircuitPanel entity={entity} account={blancoAccount} products={products} canEdit={canEdit} />
      <CircuitPanel entity={entity} account={negroAccount} products={products} canEdit={canEdit} />
    </div>
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
          <PaymentForm accountId={account.id} pendingDocuments={documents} />
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
                      {doc.purchaseLines.length > 0 && (
                        <p className="text-xs font-normal text-black/50">
                          {doc.purchaseLines
                            .map((l) => `${l.item.name} × ${formatQuantity(l.quantity)}`)
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
