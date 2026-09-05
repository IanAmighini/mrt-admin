import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Account, Product } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { findBySlugOrId } from "@/lib/slug-lookup";
import {
  getAccountBalance,
  getComprasSummary,
  getEntregasCount,
  getInvoiceableRemitos,
  getLitrosEntregados,
  getRecentCompras,
  getRecentMovementsForEntity,
  getRecentRemitos,
  getTreasuries,
} from "@/lib/ledger";
import { getCurrentPricesForAccount, getPriceHistory } from "@/lib/pricing";
import { formatMoney, formatNumeroEditable, formatQuantity, toDecimal } from "@/lib/money";
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
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const entity = await findBySlugOrId(
    () => prisma.entity.findUnique({ where: { slug: entityId }, include: { accounts: true } }),
    (id) => prisma.entity.findUnique({ where: { id }, include: { accounts: true } }),
    entityId
  );
  if (!entity) notFound();
  if (entityId !== entity.slug) redirect(`/cuentas-corrientes/${entity.slug}`);

  const blancoAccount = entity.accounts.find((a) => a.circuit === "BLANCO");
  const negroAccount = entity.accounts.find((a) => a.circuit === "NEGRO");
  if (!blancoAccount || !negroAccount) notFound();

  // Para poder corregir el saldo con el que arrancó la cuenta desde el mismo formulario de edición.
  const saldosInicialesDocs = await prisma.document.findMany({
    where: {
      accountId: { in: [blancoAccount.id, negroAccount.id] },
      type: "AJUSTE",
      number: "SALDO-INICIAL",
    },
    select: { accountId: true, totalAmount: true },
  });
  const saldoInicialDe = (accountId: string) => {
    const doc = saldosInicialesDocs.find((d) => d.accountId === accountId);
    return doc ? formatNumeroEditable(doc.totalAmount) : "";
  };
  const saldosIniciales = {
    blanco: saldoInicialDe(blancoAccount.id),
    negro: saldoInicialDe(negroAccount.id),
  };

  const isCliente = entity.type !== "PROVEEDOR";
  const isProveedor = entity.type !== "CLIENTE";
  const isSoloCliente = entity.type === "CLIENTE";

  // Todas las consultas son independientes entre sí — se disparan juntas para no encadenar
  // varias tandas de ida y vuelta a la base (cada tanda suma latencia de red completa).
  const [
    products,
    blancoSaldo,
    negroSaldo,
    recentMovements,
    invoiceableRemitos,
    blancoPrices,
    negroPrices,
    blancoPriceHistory,
    negroPriceHistory,
    entregasCount,
    litros,
    compras,
    recentRemitos,
    recentCompras,
    treasuries,
    proveedores,
  ] = await Promise.all([
    prisma.product.findMany({
      orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
    }),
    getAccountBalance(blancoAccount.id),
    getAccountBalance(negroAccount.id),
    getRecentMovementsForEntity(entity.id, 8),
    getInvoiceableRemitos(blancoAccount.id),
    getCurrentPricesForAccount(entity.id, "BLANCO"),
    getCurrentPricesForAccount(entity.id, "NEGRO"),
    getPriceHistory(entity.id, "BLANCO"),
    getPriceHistory(entity.id, "NEGRO"),
    isCliente ? getEntregasCount(entity.id) : Promise.resolve(0),
    isSoloCliente ? getLitrosEntregados(entity.id) : Promise.resolve(toDecimal(0)),
    isProveedor ? getComprasSummary(entity.id) : Promise.resolve({ count: 0, totalByUnit: new Map() }),
    isCliente ? getRecentRemitos(5, entity.id) : Promise.resolve([]),
    isProveedor ? getRecentCompras(5, entity.id) : Promise.resolve([]),
    getTreasuries(),
    isCliente
      ? prisma.entity.findMany({ where: { type: { in: ["PROVEEDOR", "AMBOS"] } }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  let card3Label = "Entregas";
  let card3Value = "0";
  let card4Label = "Litros entregados";
  let card4Value = "0";

  if (entity.type === "CLIENTE") {
    card3Value = String(entregasCount);
    card4Value = formatQuantity(litros, "L");
  } else if (entity.type === "PROVEEDOR") {
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
    card3Label = "Entregas";
    card3Value = String(entregasCount);
    card4Label = "Compras";
    card4Value = String(compras.count);
  }

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
          <FormModal triggerLabel="Editar" iconName="edit" title="Editar cliente/proveedor" action={updateEntity}>
            <EntityFormFields
              defaultType={entity.type === "PROVEEDOR" ? "PROVEEDOR" : "CLIENTE"}
              showSupplierCategory={entity.type !== "CLIENTE"}
              entity={entity}
              saldosIniciales={saldosIniciales}
            />
          </FormModal>
        )}
      </div>

      <EntitySummaryCards
        entitySlug={entity.slug}
        blancoSaldo={blancoSaldo}
        negroSaldo={negroSaldo}
        card3Label={card3Label}
        card3Value={card3Value}
        card4Label={card4Label}
        card4Value={card4Value}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {isCliente && <EntregasPanel entityId={entity.id} remitos={recentRemitos} canEdit={canEdit} />}
          {isProveedor && (
            <ComprasPanel entityId={entity.id} compras={recentCompras} canEdit={canEdit} />
          )}
        </div>
        <CuentaCorrientePanel
          entityId={entity.id}
          entityType={entity.type}
          movements={recentMovements}
          canEdit={canEdit}
          treasuries={treasuries}
          proveedores={proveedores}
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
        currentPrices={blancoPrices}
        priceHistory={blancoPriceHistory}
      />
      <PricesSection
        entityId={entity.id}
        circuit="NEGRO"
        products={products}
        canEdit={canEdit}
        currentPrices={negroPrices}
        priceHistory={negroPriceHistory}
      />
    </div>
  );
}

function PricesSection({
  entityId,
  circuit,
  products,
  canEdit,
  currentPrices,
  priceHistory,
}: {
  entityId: string;
  circuit: Account["circuit"];
  products: Product[];
  canEdit: boolean;
  currentPrices: Awaited<ReturnType<typeof getCurrentPricesForAccount>>;
  priceHistory: Awaited<ReturnType<typeof getPriceHistory>>;
}) {
  const pricedProducts = products.filter((p) => currentPrices.has(p.id));

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground/60">Circuito {CIRCUIT_LABELS[circuit]}</h2>
      <details className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
        <summary className="cursor-pointer text-sm font-semibold">Listado de precios</summary>

        <div className="mt-4 space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Producto</th>
                  <th className="py-2 pr-4">Precio vigente</th>
                  <th className="py-2 pr-4">Vigente desde</th>
                </tr>
              </thead>
              <tbody>
                {pricedProducts.map((product) => {
                  const price = currentPrices.get(product.id)!;
                  return (
                    <tr key={product.id} className="border-b border-foreground/5">
                      <td className="py-2 pr-4">{productLabel(product)}</td>
                      <td className="py-2 pr-4">{formatMoney(price.amount, price.currency)}</td>
                      <td className="py-2 pr-4">{price.validFrom.toLocaleDateString("es-AR")}</td>
                    </tr>
                  );
                })}
                {pricedProducts.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-foreground/40">
                      Todavía no hay precios cargados para este circuito.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canEdit && (
            <form action={createPrice} className="space-y-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
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
                  <tr className="border-b border-foreground/10 text-left text-foreground/60">
                    <th className="py-2 pr-4">Producto</th>
                    <th className="py-2 pr-4">Precio</th>
                    <th className="py-2 pr-4">Vigente desde</th>
                    <th className="py-2 pr-4">Cargado por</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.map((price) => (
                    <tr key={price.id} className="border-b border-foreground/5">
                      <td className="py-2 pr-4">{productLabel(price.product)}</td>
                      <td className="py-2 pr-4">{formatMoney(price.amount, price.currency)}</td>
                      <td className="py-2 pr-4">{price.validFrom.toLocaleDateString("es-AR")}</td>
                      <td className="py-2 pr-4">{price.createdBy.name}</td>
                    </tr>
                  ))}
                  {priceHistory.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-foreground/40">
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

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const selectClass = inputClass;
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
