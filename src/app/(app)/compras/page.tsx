import Link from "next/link";
import { Package, Plus, ReceiptText } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getDocumentPending, getRecentCompras, getRecentGastos } from "@/lib/ledger";
import { formatMoney, formatNumeroExacto, formatQuantity, ZERO } from "@/lib/money";
import type { Currency, Prisma } from "@prisma/client";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { CompraFormFields, filaDeCompra } from "@/components/CompraForm";
import { GastoFormFields } from "@/components/GastoFormFields";
import { desgloseDesdeDocumento } from "@/lib/impuestos";
import { facturaDeCompra } from "@/lib/compra-factura";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { FilterBar, FiltroBuscar, FiltroFechas, FiltroSelect } from "@/components/ui/FilterBar";
import {
  createGasto,
  deleteCompra,
  deleteGasto,
  updateCompra,
  updateGasto,
} from "../cuentas-corrientes/[entityId]/actions";
import { addDays, formatFecha, hoyComoFecha, hoyEnInput, parseFecha, toDateInputValue } from "@/lib/period";

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

  const [items, proveedores, compras, gastos, subcuentas] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    prisma.entity.findMany({
      where: { type: { in: ["PROVEEDOR", "AMBOS"] } },
      select: { id: true, name: true, expenseCategory: true, moneda: true },
      orderBy: { name: "asc" },
    }),
    tipoFilter === "gastos" ? Promise.resolve([]) : getRecentCompras(500, undefined, q, period),
    tipoFilter === "insumos" ? Promise.resolve([]) : getRecentGastos(500, undefined, q, period),
    // Los proveedores que dividen su cuenta (Goloeste: alquiler y gastos comunes), para que el gasto
    // se pueda asignar a una parte también desde acá.
    prisma.entity.findMany({
      where: { type: { in: ["PROVEEDOR", "AMBOS"] }, llevaViajes: true },
      select: {
        id: true,
        rotuloSubcuenta: true,
        entregas: { select: { id: true, nombre: true, destino: true }, orderBy: [{ fecha: "desc" }, { createdAt: "desc" }] },
      },
    }),
  ]);
  const subcuentasPorProveedor = Object.fromEntries(
    subcuentas.map((e) => [e.id, { viajes: e.entregas, rotulo: e.rotuloSubcuenta ?? "Subcuenta" }])
  );

  const rows = [...compras, ...gastos]
    .map((doc) => {
      const pendiente = getDocumentPending(doc);
      return { doc, pendiente, pagado: pendiente.lessThan(0.005) };
    })
    .sort((a, b) => b.doc.date.getTime() - a.doc.date.getTime() || b.doc.createdAt.getTime() - a.doc.createdAt.getTime());

  const todasLasFilas = rows.filter((r) => {
    if (pagoFilter === "pagado") return r.pagado;
    if (pagoFilter === "sin_pagar") return !r.pagado;
    return true;
  });
  // Sin filtro, lo último: es lo que se mira para ver si algo ya se cargó. Para más, se filtra.
  const filteredRows = hayFiltro ? todasLasFilas : todasLasFilas.slice(0, 60);
  const sinPagar = todasLasFilas.filter((r) => !r.pagado).length;

  // Los atajos de período, en el día de acá.
  const hoy = hoyEnInput();
  const dia = (d: Date) => toDateInputValue(d);
  const menosDias = (n: number) => dia(new Date(parseFecha(hoy).getTime() - n * 86_400_000));
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const finMesPasado = dia(new Date(parseFecha(inicioMes).getTime() - 86_400_000));
  const atajos = [
    { label: "Este mes", from: inicioMes, to: hoy },
    { label: "Mes pasado", from: `${finMesPasado.slice(0, 8)}01`, to: finMesPasado },
    { label: "Últimos 7 días", from: menosDias(6), to: hoy },
  ];
  const conFiltros = (extra: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, tipo: tipoFilter, pago: pagoFilter, from, to, ...extra })) if (v) qs.set(k, v);
    const t = qs.toString();
    return t ? `/compras?${t}` : "/compras";
  };

  // De a un día por bloque, con su subtotal: es como se controla contra los papeles.
  const porDia = new Map<string, typeof filteredRows>();
  for (const r of filteredRows) porDia.set(dia(r.doc.date), [...(porDia.get(dia(r.doc.date)) ?? []), r]);
  const ayer = menosDias(1);
  const tituloDelDia = (d: string) => {
    const fecha = parseFecha(d);
    const semana = fecha.toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
    const corto = fecha.toLocaleDateString("es-AR", { day: "numeric", month: "numeric", timeZone: "UTC" });
    if (d === hoy) return `Hoy · ${semana} ${corto}`;
    if (d === ayer) return `Ayer · ${semana} ${corto}`;
    return `${semana[0].toUpperCase()}${semana.slice(1)} ${corto}${d.slice(0, 4) !== hoy.slice(0, 4) ? `/${d.slice(0, 4)}` : ""}`;
  };
  const sumarPorMoneda = (lista: typeof filteredRows, campo: (r: (typeof filteredRows)[number]) => Prisma.Decimal) => {
    const m = new Map<Currency, Prisma.Decimal>();
    for (const r of lista) m.set(r.doc.currency, (m.get(r.doc.currency) ?? ZERO).plus(campo(r)));
    return Array.from(m.entries())
      .sort(([a]) => (a === "ARS" ? -1 : 1))
      .map(([moneda, monto]) => formatMoney(monto, moneda))
      .join(" + ");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">Compras y gastos</h1>
          <p className="text-sm text-foreground/60">
            {hayFiltro
              ? `${filteredRows.length} ${filteredRows.length === 1 ? "comprobante" : "comprobantes"} · ${sumarPorMoneda(filteredRows, (r) => r.doc.totalAmount) || formatMoney(0)}`
              : `Los últimos ${filteredRows.length} comprobantes`}
            {sinPagar > 0 && !hayFiltro && (
              <>
                {" · "}
                <Link href="/compras?pago=sin_pagar" className="text-amber-700 underline-offset-2 hover:underline dark:text-amber-400">
                  {sinPagar} sin pagar
                </Link>
              </>
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
              <GastoFormFields proveedores={proveedores} subcuentasPorProveedor={subcuentasPorProveedor} />
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

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-foreground/50">Ver:</span>
        {atajos.map((a) => {
          const activo = from === a.from && to === a.to;
          return (
            <Link
              key={a.label}
              href={conFiltros({ from: a.from, to: a.to })}
              className={`rounded-full border px-3 py-1 transition-colors ${
                activo ? "border-primary bg-primary/20 font-medium" : "border-foreground/15 text-foreground/70 hover:border-primary"
              }`}
            >
              {a.label}
            </Link>
          );
        })}
      </div>

      <div className="space-y-5">
        {Array.from(porDia.entries()).map(([d, delDia]) => (
          <section key={d} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 px-1 text-sm">
              <h2 className="font-medium text-foreground/70">{tituloDelDia(d)}</h2>
              <span className="tabular-nums text-foreground/60">{sumarPorMoneda(delDia, (r) => r.doc.totalAmount)}</span>
            </div>
            <div className="divide-y divide-foreground/10 rounded-xl border border-foreground/10 bg-background shadow-sm">
              {delDia.map(({ doc, pagado, pendiente }) => {
                const esGasto = doc.type === "GASTO";
                const Icono = esGasto ? ReceiptText : Package;
                // El concepto de un gasto, salvo que sea el mismo rubro que ya dice la etiqueta.
                const detalle = esGasto
                  ? doc.reason && doc.reason !== (doc.expenseCategory && EXPENSE_CATEGORY_LABELS[doc.expenseCategory])
                    ? doc.reason
                    : null
                  : doc.purchaseLines.map((l) => `${l.item.name} × ${formatQuantity(l.quantity)}`).join(" · ");
                const vencido = !pagado && doc.dueDate && doc.dueDate < hoyComoFecha();
                const parcial = !pagado && pendiente.lessThan(doc.totalAmount);
                return (
                  <div key={doc.id} className="flex items-center gap-3 px-4 py-3 first:rounded-t-xl last:rounded-b-xl">
                    <span
                      className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground/60 sm:flex"
                      title={esGasto ? "Gasto" : "Compra de insumos"}
                    >
                      <Icono size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/cuentas-corrientes/${doc.account.entity.slug}`}
                        className="font-medium hover:underline hover:underline-offset-2"
                      >
                        {doc.account.entity.name}
                      </Link>
                      {/* En el celular el monto va acá: a la derecha pisaba las etiquetas. */}
                      <p className="font-semibold tabular-nums sm:hidden">{formatMoney(doc.totalAmount, doc.currency)}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className={PILL}>
                          {esGasto ? "Gasto" : DOCUMENT_TYPE_LABELS[doc.type]} #{doc.number}
                        </span>
                        {esGasto && doc.expenseCategory && <span className={PILL}>{EXPENSE_CATEGORY_LABELS[doc.expenseCategory]}</span>}
                        <span className={PILL}>{CIRCUIT_LABELS[doc.account.circuit].split(" (")[0]}</span>
                        <span
                          className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${
                            pagado
                              ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          }`}
                        >
                          {pagado
                            ? "Pagado"
                            : parcial
                              ? `Falta pagar ${formatMoney(pendiente, doc.currency)}`
                              : "Sin pagar"}
                          {!pagado && doc.dueDate && ` · ${vencido ? "venció" : "vence"} el ${formatFecha(doc.dueDate)}`}
                        </span>
                      </div>
                      {detalle && <p className="mt-1 truncate text-xs text-foreground/50">{detalle}</p>}
                    </div>
                    <p className="hidden shrink-0 text-right text-lg font-semibold tabular-nums sm:block">
                      {formatMoney(doc.totalAmount, doc.currency)}
                    </p>
                    {canEdit && (
                      <div className="flex shrink-0 items-center">
                        {esGasto ? (
                          <>
                            <FormModal
                              triggerLabel="Editar"
                              soloIcono
                              iconName="edit"
                              title="Editar gasto"
                              action={updateGasto}
                              maxWidthClass="max-w-xl"
                            >
                              <GastoFormFields
                                monedaCuenta={doc.account.entity.moneda}
                                entityId={doc.account.entityId}
                                editingDocumentId={doc.id}
                                viajes={subcuentasPorProveedor[doc.account.entityId]?.viajes}
                                rotuloSubcuenta={subcuentasPorProveedor[doc.account.entityId]?.rotulo}
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
                                  entregaId: doc.entregaId,
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
                              soloIcono
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
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {filteredRows.length === 0 && (
          <p className="rounded-xl border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/40">
            {hayFiltro ? "No hay comprobantes con este filtro." : "Todavía no hay compras ni gastos cargados."}
          </p>
        )}
      </div>
    </div>
  );
}

const PILL = "max-w-full truncate whitespace-nowrap rounded-md bg-foreground/[0.05] px-2 py-0.5 text-xs text-foreground/60";
