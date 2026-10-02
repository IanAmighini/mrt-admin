import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getDocumentPending, getRecentCompras, getRecentGastos } from "@/lib/ledger";
import { formatMoney, formatNumeroExacto, formatQuantity, sumDecimals } from "@/lib/money";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { CompraFormFields, filaDeCompra } from "@/components/CompraForm";
import { GastoFormFields } from "@/components/GastoFormFields";
import { desgloseDesdeDocumento } from "@/lib/impuestos";
import { facturaDeCompra } from "@/lib/compra-factura";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { FilterBar, FiltroBuscar, FiltroFechas, FiltroSelect } from "@/components/ui/FilterBar";
import { Table, TableEmpty, Td, Th, Thead, Tr } from "@/components/ui/Table";
import {
  createGasto,
  deleteCompra,
  deleteGasto,
  updateCompra,
  updateGasto,
} from "../cuentas-corrientes/[entityId]/actions";
import { addDays, formatFecha, parseFecha, toDateInputValue } from "@/lib/period";

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
  searchParams: Promise<{ q?: string; pago?: string; tipo?: string; from?: string; to?: string }>;
}) {
  const { q, pago, tipo, from, to } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const pagoFilter = PAGO_FILTERS.some((f) => f.value === pago) ? (pago as "" | "pagado" | "sin_pagar") : "";
  const tipoFilter = TIPO_FILTERS.some((f) => f.value === tipo) ? (tipo as "" | "insumos" | "gastos") : "";
  // El rango va a la consulta, no al filtrado posterior: el `take` de 500 recorta antes.
  const period = {
    from: from ? parseFecha(from) : null,
    to: to ? addDays(parseFecha(to), 1) : null,
  };
  const hayFiltro = Boolean(q?.trim() || pagoFilter || tipoFilter || from || to);

  const [items, proveedores, compras, gastos] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    prisma.entity.findMany({
      where: { type: { in: ["PROVEEDOR", "AMBOS"] } },
      select: { id: true, name: true, expenseCategory: true },
      orderBy: { name: "asc" },
    }),
    tipoFilter === "gastos" ? Promise.resolve([]) : getRecentCompras(500, undefined, q, period),
    tipoFilter === "insumos" ? Promise.resolve([]) : getRecentGastos(500, undefined, q, period),
  ]);

  const rows = [...compras, ...gastos]
    .map((doc) => ({ doc, pagado: getDocumentPending(doc).lessThanOrEqualTo(0) }))
    .sort((a, b) => b.doc.date.getTime() - a.doc.date.getTime());

  const filteredRows = rows.filter((r) => {
    if (pagoFilter === "pagado") return r.pagado;
    if (pagoFilter === "sin_pagar") return !r.pagado;
    return true;
  });

  // Cuánto suma lo que se está viendo, y cuánto de eso falta pagar. Sin esto hay que ir a
  // Reportes para responder "cuánto gasté este mes", que es la pregunta de esta pantalla.
  const total = sumDecimals(filteredRows.map((r) => r.doc.totalAmount));
  const pendiente = sumDecimals(filteredRows.map((r) => getDocumentPending(r.doc)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">Compras y gastos</h1>
          <p className="text-sm text-foreground/60">
            {filteredRows.length} {filteredRows.length === 1 ? "comprobante" : "comprobantes"} ·{" "}
            {formatMoney(total)}
            {pendiente.greaterThan(0) && (
              <span className="text-amber-600 dark:text-amber-400">
                {" "}
                · {formatMoney(pendiente)} sin pagar
              </span>
            )}
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

      <FilterBar limpiarHref="/compras" hayFiltro={hayFiltro}>
        <FiltroBuscar defaultValue={q} placeholder="Proveedor, comprobante o concepto…" />
        <FiltroSelect
          label="Tipo"
          name="tipo"
          defaultValue={tipoFilter}
          todos="Insumos y gastos"
          opciones={TIPO_FILTERS.filter((f) => f.value).map((f) => ({ value: f.value, label: f.label }))}
        />
        <FiltroSelect
          label="Estado"
          name="pago"
          defaultValue={pagoFilter}
          opciones={PAGO_FILTERS.filter((f) => f.value).map((f) => ({ value: f.value, label: f.label }))}
        />
        <FiltroFechas from={from} to={to} />
      </FilterBar>

      <Table>
        <Thead>
          <Th>Proveedor</Th>
          <Th>Comprobante</Th>
          <Th>Fecha</Th>
          <Th align="derecha">Total</Th>
          <Th>Pago</Th>
          {canEdit && <Th>Acciones</Th>}
        </Thead>
          <tbody>
            {filteredRows.map(({ doc, pagado }) => {
              const esGasto = doc.type === "GASTO";
              return (
              <Tr key={doc.id}>
                <Td>
                  <Link
                    href={`/cuentas-corrientes/${doc.account.entity.slug}`}
                    className="underline underline-offset-2"
                  >
                    {doc.account.entity.name}
                  </Link>
                </Td>
                <Td>
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
                </Td>
                <Td className="whitespace-nowrap">{formatFecha(doc.date)}</Td>
                <Td numero>{formatMoney(doc.totalAmount, doc.currency)}</Td>
                <Td>
                  <span
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      pagado
                        ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                    }`}
                  >
                    {pagado ? "Pagado" : "Sin pagar"}
                  </span>
                </Td>
                {canEdit && (
                  <Td>
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
                                exchangeRate: formatNumeroExacto(doc.exchangeRate),
                                amount: formatNumeroExacto(doc.totalAmount),
                                retentionAmount: formatNumeroExacto(doc.retentionAmount),
                                tributos: desgloseDesdeDocumento(doc),
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
                            maxWidthClass="max-w-5xl"
                          >
                            <CompraFormFields
                              entidad={{ id: doc.account.entity.id, name: doc.account.entity.name, moneda: doc.account.entity.moneda }}
                              items={items}
                              editingDocumentId={doc.id}
                              defaultValues={{
                                number: doc.number,
                                date: toDateInputValue(doc.date),
                                dueDate: doc.dueDate ? toDateInputValue(doc.dueDate) : undefined,
                                exchangeRate: formatNumeroExacto(doc.exchangeRate),
                              }}
                              defaultRows={doc.purchaseLines.map((l) => filaDeCompra(l, doc.account.circuit))}
                              impuestos={desgloseDesdeDocumento(doc)}
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
                  </Td>
                )}
              </Tr>
              );
            })}
            {filteredRows.length === 0 && (
              <TableEmpty colSpan={canEdit ? 6 : 5}>
                {hayFiltro
                  ? "No hay comprobantes con este filtro."
                  : "Todavía no hay compras ni gastos cargados."}
              </TableEmpty>
            )}
          </tbody>
        </Table>
    </div>
  );
}
