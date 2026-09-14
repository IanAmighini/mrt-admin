import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getDocumentPending, getRecentCompras, getRecentGastos } from "@/lib/ledger";
import { formatMoney, formatQuantity } from "@/lib/money";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { CompraFormFields } from "@/components/CompraForm";
import { GastoFormFields } from "@/components/GastoFormFields";
import { impuestosDesdeDocumento, tributosDeGasto } from "@/lib/impuestos";
import { facturaDeCompra } from "@/lib/compra-factura";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import {
  createGasto,
  deleteCompra,
  deleteGasto,
  updateCompra,
  updateGasto,
} from "../cuentas-corrientes/[entityId]/actions";
import { toDateInputValue } from "@/lib/period";

const PAGO_FILTERS: { value: "" | "pagado" | "sin_pagar"; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "pagado", label: "Pagado" },
  { value: "sin_pagar", label: "Sin pagar" },
];

/** La página junta las dos cosas que se le compran a un proveedor: insumos y gastos. */
const TIPO_FILTERS: { value: "" | "insumos" | "gastos"; label: string }[] = [
  { value: "", label: "Insumos y gastos" },
  { value: "insumos", label: "Solo insumos" },
  { value: "gastos", label: "Solo gastos" },
];

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pago?: string; tipo?: string }>;
}) {
  const { q, pago, tipo } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const pagoFilter = PAGO_FILTERS.some((f) => f.value === pago) ? (pago as "" | "pagado" | "sin_pagar") : "";
  const tipoFilter = TIPO_FILTERS.some((f) => f.value === tipo) ? (tipo as "" | "insumos" | "gastos") : "";

  const [items, proveedores, compras, gastos] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    prisma.entity.findMany({
      where: { type: { in: ["PROVEEDOR", "AMBOS"] } },
      select: { id: true, name: true, expenseCategory: true },
      orderBy: { name: "asc" },
    }),
    tipoFilter === "gastos" ? Promise.resolve([]) : getRecentCompras(500, undefined, q),
    tipoFilter === "insumos" ? Promise.resolve([]) : getRecentGastos(500, undefined, q),
  ]);

  const rows = [...compras, ...gastos]
    .map((doc) => ({ doc, pagado: getDocumentPending(doc).lessThanOrEqualTo(0) }))
    .sort((a, b) => b.doc.date.getTime() - a.doc.date.getTime());

  const filteredRows = rows.filter((r) => {
    if (pagoFilter === "pagado") return r.pagado;
    if (pagoFilter === "sin_pagar") return !r.pagado;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold mb-1">Compras y gastos</h1>
          <p className="text-sm text-foreground/60">
            {filteredRows.length} {filteredRows.length === 1 ? "comprobante" : "comprobantes"}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <FormModal
              triggerLabel="Nuevo gasto"
              title="Nueva factura de gasto"
              action={createGasto}
              maxWidthClass="max-w-xl"
            >
              <GastoFormFields proveedores={proveedores} />
            </FormModal>
            <Link
              href="/compras/nueva"
              className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              <Plus size={16} />
              Nueva compra
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form className="flex flex-1 min-w-[240px] gap-2">
          {pagoFilter && <input type="hidden" name="pago" value={pagoFilter} />}
          {tipoFilter && <input type="hidden" name="tipo" value={tipoFilter} />}
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Buscar por proveedor, comprobante o concepto…"
              className="w-full rounded-lg border border-foreground/20 bg-background py-2 pl-9 pr-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <button type="submit" className="rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm hover:bg-foreground/5">
            Buscar
          </button>
        </form>
        <div className="flex flex-wrap gap-1">
          {TIPO_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={{
                pathname: "/compras",
                query: { ...(q ? { q } : {}), ...(pagoFilter ? { pago: pagoFilter } : {}), ...(f.value ? { tipo: f.value } : {}) },
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                tipoFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "border border-foreground/20 hover:bg-foreground/5"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {PAGO_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={{
                pathname: "/compras",
                query: { ...(q ? { q } : {}), ...(tipoFilter ? { tipo: tipoFilter } : {}), ...(f.value ? { pago: f.value } : {}) },
              }}
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
              <th className="py-2 pr-4">Proveedor</th>
              <th className="py-2 pr-4">Comprobante</th>
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Total</th>
              <th className="py-2 pr-4">Pago</th>
              {canEdit && <th className="py-2 pr-4">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(({ doc, pagado }) => {
              const esGasto = doc.type === "GASTO";
              return (
              <tr key={doc.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4">
                  <Link
                    href={`/cuentas-corrientes/${doc.account.entity.slug}`}
                    className="underline underline-offset-2"
                  >
                    {doc.account.entity.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  <span className="flex items-center gap-1.5">
                    {esGasto && (
                      <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs font-medium">Gasto</span>
                    )}
                    #{doc.number}
                  </span>
                  <p className="text-xs font-normal text-foreground/50">
                    {esGasto
                      ? [doc.expenseCategory && EXPENSE_CATEGORY_LABELS[doc.expenseCategory], doc.reason]
                          .filter(Boolean)
                          .join(" · ")
                      : doc.purchaseLines
                          .map((l) => `${l.item.name} × ${formatQuantity(l.quantity)}`)
                          .join(" · ")}
                  </p>
                </td>
                <td className="py-2 pr-4">{doc.date.toLocaleDateString("es-AR")}</td>
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
                      {esGasto ? (
                        <>
                          <FormModal
                            triggerLabel="Editar"
                            iconName="edit"
                            title="Editar gasto"
                            action={updateGasto}
                            maxWidthClass="max-w-xl"
                          >
                            <GastoFormFields
                              entityId={doc.account.entityId}
                              editingDocumentId={doc.id}
                              defaultValues={{
                                circuit: doc.account.circuit,
                                expenseCategory: doc.expenseCategory ?? undefined,
                                reason: doc.reason ?? undefined,
                                number: doc.number,
                                date: toDateInputValue(doc.date),
                                dueDate: doc.dueDate ? toDateInputValue(doc.dueDate) : undefined,
                                currency: doc.currency,
                                exchangeRate: doc.exchangeRate?.toString(),
                                amount: doc.totalAmount.toString(),
                                retentionAmount: doc.retentionAmount?.toString(),
                                tributos: tributosDeGasto(doc),
                              }}
                            />
                          </FormModal>
                          <DeleteButton
                            action={deleteGasto}
                            hiddenName="documentId"
                            hiddenValue={doc.id}
                            nombre={`el gasto #${doc.number}`}
                          />
                        </>
                      ) : (
                        <>
                          <FormModal
                            triggerLabel="Editar"
                            iconName="edit"
                            title="Editar compra"
                            action={updateCompra}
                            maxWidthClass="max-w-2xl"
                          >
                            <CompraFormFields
                              entityId={doc.account.entityId}
                              items={items}
                              editingDocumentId={doc.id}
                              defaultValues={{
                                number: doc.number,
                                date: toDateInputValue(doc.date),
                                dueDate: doc.dueDate ? toDateInputValue(doc.dueDate) : undefined,
                                currency: doc.currency,
                                exchangeRate: doc.exchangeRate?.toString(),
                              }}
                              impuestos={impuestosDesdeDocumento(doc)}
                              factura={facturaDeCompra(doc)}
                            />
                          </FormModal>
                          <DeleteButton
                            action={deleteCompra}
                            hiddenName="documentId"
                            hiddenValue={doc.id}
                            nombre={`la compra #${doc.number}`}
                            consecuencia="El stock que sumó se revierte."
                          />
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="py-6 text-center text-foreground/40">
                  {q || pagoFilter ? "No hay compras con este filtro." : "Todavía no hay compras cargadas."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
