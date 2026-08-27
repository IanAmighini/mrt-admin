import Link from "next/link";
import { notFound } from "next/navigation";
import type { Account, Product } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import {
  getAccountBalance,
  getComprasSummary,
  getEntregasCount,
  getInvoiceableRemitos,
  getLitrosEntregados,
  getRecentCompras,
  getRecentMovementsForEntity,
  getRecentRemitos,
} from "@/lib/ledger";
import { getCurrentPricesForAccount, getPriceHistory } from "@/lib/pricing";
import { formatMoney, formatQuantity } from "@/lib/money";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { formatProductLabel as productLabel } from "@/lib/product-label";
import { createPrice } from "./actions";
import { updateEntity } from "@/app/(app)/clientes/actions";
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

  const [products, items, blancoSaldo, negroSaldo, recentMovements, invoiceableRemitos] =
    await Promise.all([
      prisma.product.findMany({ orderBy: { name: "asc" } }),
      prisma.item.findMany({ orderBy: { name: "asc" } }),
      getAccountBalance(blancoAccount.id),
      getAccountBalance(negroAccount.id),
      getRecentMovementsForEntity(entity.id, 8),
      getInvoiceableRemitos(blancoAccount.id),
    ]);

  const blancoPrices = await getCurrentPricesForAccount(entity.id, "BLANCO");
  const negroPrices = await getCurrentPricesForAccount(entity.id, "NEGRO");

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
        <CuentaCorrientePanel
          entityId={entity.id}
          movements={recentMovements}
          canEdit={canEdit}
          factura={
            isCliente
              ? {
                  blancoAccountId: blancoAccount.id,
                  isWithholdingAgent: entity.isWithholdingAgent,
                  invoiceableRemitos,
                }
              : undefined
          }
        />
      </div>

      <PricesSection
        entityId={entity.id}
        circuit="BLANCO"
        products={products}
        canEdit={canEdit}
      />
      <PricesSection
        entityId={entity.id}
        circuit="NEGRO"
        products={products}
        canEdit={canEdit}
      />
    </div>
  );
}

async function PricesSection({
  entityId,
  circuit,
  products,
  canEdit,
}: {
  entityId: string;
  circuit: Account["circuit"];
  products: Product[];
  canEdit: boolean;
}) {
  const [currentPrices, priceHistory] = await Promise.all([
    getCurrentPricesForAccount(entityId, circuit),
    getPriceHistory(entityId, circuit),
  ]);

  const pricedProducts = products.filter((p) => currentPrices.has(p.id));

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-black/60">Circuito {CIRCUIT_LABELS[circuit]}</h2>
      <details className="rounded-lg border border-black/10 p-4">
        <summary className="cursor-pointer text-sm font-semibold">Listado de precios</summary>

        <div className="mt-4 space-y-4">
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
                {pricedProducts.map((product) => {
                  const price = currentPrices.get(product.id)!;
                  return (
                    <tr key={product.id} className="border-b border-black/5">
                      <td className="py-2 pr-4">{productLabel(product)}</td>
                      <td className="py-2 pr-4">{formatMoney(price.amount, price.currency)}</td>
                      <td className="py-2 pr-4">{price.validFrom.toLocaleDateString("es-AR")}</td>
                    </tr>
                  );
                })}
                {pricedProducts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-black/40">
                      Todavía no hay precios cargados para este circuito.
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
                        {productLabel(product)}
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
                      <td className="py-2 pr-4">{productLabel(price.product)}</td>
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
      </details>
    </section>
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
