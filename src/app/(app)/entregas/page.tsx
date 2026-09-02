import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getDocumentPending, getRecentRemitos } from "@/lib/ledger";
import { getAllCurrentPrices } from "@/lib/pricing";
import { formatMoney, formatQuantity } from "@/lib/money";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { RemitoFormFields } from "@/components/RemitoForm";
import { deleteRemito, updateRemito } from "../cuentas-corrientes/[entityId]/actions";

const PAGO_FILTERS: { value: "" | "pagado" | "sin_pagar"; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "pagado", label: "Pagado" },
  { value: "sin_pagar", label: "Sin pagar" },
];

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function EntregasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pago?: string }>;
}) {
  const { q, pago } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const pagoFilter = PAGO_FILTERS.some((f) => f.value === pago) ? (pago as "" | "pagado" | "sin_pagar") : "";

  const [remitos, products, allPrices] = await Promise.all([
    getRecentRemitos(500, undefined, q),
    prisma.product.findMany({
      orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
    }),
    getAllCurrentPrices(),
  ]);

  const pricesByEntity: Record<
    string,
    Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>>
  > = {};
  for (const price of allPrices.values()) {
    const byCircuit = (pricesByEntity[price.entityId] ??= { BLANCO: {}, NEGRO: {} });
    byCircuit[price.circuit][price.productId] = { amount: price.amount.toNumber(), currency: price.currency };
  }

  const rows = remitos.map((doc) => {
    const pending = getDocumentPending(doc);
    const pallets = doc.lines.reduce((acc, l) => acc + l.quantity.toNumber(), 0);
    const defaultLines = doc.lines.map((l) => {
      const perPallet = (l.product.boxesPerPallet ?? 0) * (l.product.unitsPerBox ?? 0);
      const pricePerBottle = perPallet > 0 ? l.unitPrice.dividedBy(perPallet) : l.unitPrice;
      return {
        productId: l.productId,
        quantity: l.quantity.toString(),
        pricePerBottle: pricePerBottle.toString(),
        circuit: doc.account.circuit,
      };
    });
    return { doc, pallets, pagado: pending.lessThanOrEqualTo(0), defaultLines };
  });

  const filteredRows = rows.filter((r) => {
    if (pagoFilter === "pagado") return r.pagado;
    if (pagoFilter === "sin_pagar") return !r.pagado;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold mb-1">Entregas</h1>
          <p className="text-sm text-foreground/60">{filteredRows.length} entregas registradas</p>
        </div>
        {canEdit && (
          <Link
            href="/entregas/nueva"
            className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            <Plus size={16} />
            Nueva entrega
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form className="flex flex-1 min-w-[240px] gap-2">
          {pagoFilter && <input type="hidden" name="pago" value={pagoFilter} />}
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Buscar por cliente o remito…"
              className="w-full rounded-lg border border-foreground/20 bg-background py-2 pl-9 pr-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <button type="submit" className="rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm hover:bg-foreground/5">
            Buscar
          </button>
        </form>
        <div className="flex flex-wrap gap-1">
          {PAGO_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={{ pathname: "/entregas", query: { ...(q ? { q } : {}), ...(f.value ? { pago: f.value } : {}) } }}
              className={`rounded px-3 py-1.5 text-sm ${
                pagoFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "border border-foreground/20 hover:bg-foreground/5"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Remito</th>
              <th className="py-2 pr-4">Cliente</th>
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Pallets</th>
              <th className="py-2 pr-4">Total</th>
              <th className="py-2 pr-4">Pago</th>
              {canEdit && <th className="py-2 pr-4">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ doc, pallets, pagado, defaultLines }) => (
              <tr key={doc.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4">#{doc.number}</td>
                <td className="py-2 pr-4">
                  <Link
                    href={`/cuentas-corrientes/${doc.account.entity.slug}`}
                    className="underline underline-offset-2"
                  >
                    {doc.account.entity.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{doc.date.toLocaleDateString("es-AR")}</td>
                <td className="py-2 pr-4">{formatQuantity(pallets, "pallets")}</td>
                <td className="py-2 pr-4">{formatMoney(doc.totalAmount, doc.currency)}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      pagado
                        ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    }`}
                  >
                    {pagado ? "Pagado" : "Sin pagar"}
                  </span>
                </td>
                {canEdit && (
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <FormModal
                        triggerLabel="Editar"
                        iconName="edit"
                        title="Editar remito"
                        action={updateRemito}
                        maxWidthClass="max-w-2xl"
                      >
                        <RemitoFormFields
                          entityId={doc.account.entityId}
                          products={products}
                          priceMapByCircuit={pricesByEntity[doc.account.entityId] ?? { BLANCO: {}, NEGRO: {} }}
                          editingDocumentId={doc.id}
                          defaultValues={{
                            number: doc.number,
                            date: toDateInputValue(doc.date),
                            dueDate: doc.dueDate ? toDateInputValue(doc.dueDate) : undefined,
                            currency: doc.currency,
                            exchangeRate: doc.exchangeRate?.toString(),
                          }}
                          defaultLines={defaultLines}
                        />
                      </FormModal>
                      <DeleteButton
                        action={deleteRemito}
                        hiddenName="documentId"
                        hiddenValue={doc.id}
                        confirmMessage="¿Borrar este remito? Esta acción no se puede deshacer."
                      />
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="py-6 text-center text-foreground/40">
                  {q || pagoFilter ? "No hay entregas con este filtro." : "Todavía no hay entregas cargadas."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
