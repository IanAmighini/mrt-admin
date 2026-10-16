import Link from "next/link";
import { DiaPlegable } from "@/components/DiaPlegable";
import { formatLineasDeRemito } from "@/lib/product-label";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getDocumentPending, getRecentRemitos } from "@/lib/ledger";
import { getAllCurrentPrices } from "@/lib/pricing";
import { formatMoney, formatNumeroExacto, ZERO } from "@/lib/money";
import type { Currency, Prisma } from "@prisma/client";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { ETIQUETA, ETIQUETA_DESTACADA, EstadoDePago } from "@/components/Etiquetas";
import { iniciales } from "@/components/CuentasLista";
import { agruparPorDia, diasDeReferencia, tituloDelDia } from "@/lib/lista-por-dia";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { RemitoFormFields, lineaDeRemito } from "@/components/RemitoForm";
import { FilterBar, FiltroBuscar, FiltroFechas, FiltroSelect } from "@/components/ui/FilterBar";
import { deleteRemito, updateRemito } from "../cuentas-corrientes/[entityId]/actions";
import { addDays, formatFecha, hoyComoFecha, parseFecha, toDateInputValue } from "@/lib/period";

const PAGO_FILTERS: { value: "" | "pagado" | "sin_pagar"; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "pagado", label: "Pagado" },
  { value: "sin_pagar", label: "Sin pagar" },
];

export default async function EntregasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pago?: string; from?: string; to?: string }>;
}) {
  const { q, pago, from, to } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const pagoFilter = PAGO_FILTERS.some((f) => f.value === pago) ? (pago as "" | "pagado" | "sin_pagar") : "";
  // El rango va a la consulta: el `take` de 500 recorta antes que cualquier filtro en memoria.
  const period = {
    from: from ? parseFecha(from) : null,
    to: to ? addDays(parseFecha(to), 1) : null,
  };
  const hayFiltro = Boolean(q?.trim() || pagoFilter || from || to);

  const [remitos, products, allPrices, todosLosViajes, todosLosDestinatarios] = await Promise.all([
    getRecentRemitos(500, undefined, q, period),
    prisma.product.findMany({
      orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
    }),
    getAllCurrentPrices(),
    prisma.entrega.findMany({
      where: { entity: { llevaViajes: true } },
      orderBy: [{ fecha: "desc" }],
      select: { id: true, nombre: true, destino: true, entityId: true },
    }),
    prisma.destinatario.findMany({
      where: { entity: { llevaViajes: true } },
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true, taxId: true, entityId: true },
    }),
  ]);

  // Agrupados por cliente, igual que los precios: este listado mezcla remitos de todos y cada
  // formulario de edicion tiene que ofrecer solo los del suyo.
  const viajesByEntity = new Map<string, { id: string; nombre: string; destino: string | null }[]>();
  for (const v of todosLosViajes) {
    const lista = viajesByEntity.get(v.entityId) ?? [];
    lista.push({ id: v.id, nombre: v.nombre, destino: v.destino });
    viajesByEntity.set(v.entityId, lista);
  }
  const destinatariosByEntity = new Map<string, { id: string; nombre: string; taxId: string | null }[]>();
  for (const d of todosLosDestinatarios) {
    const lista = destinatariosByEntity.get(d.entityId) ?? [];
    lista.push({ id: d.id, nombre: d.nombre, taxId: d.taxId });
    destinatariosByEntity.set(d.entityId, lista);
  }

  const pricesByEntity: Record<
    string,
    Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>>
  > = {};
  for (const price of allPrices.values()) {
    const byCircuit = (pricesByEntity[price.entityId] ??= { BLANCO: {}, NEGRO: {} });
    byCircuit[price.circuit][price.productId] = { amount: price.amount.toNumber(), currency: price.currency };
  }

  const rows = remitos
    .map((doc) => {
      const pendiente = getDocumentPending(doc);
      const defaultLines = doc.lines.map((l) => lineaDeRemito(l, doc.account.circuit));
      return { doc, pendiente, pagado: pendiente.lessThan(0.005), defaultLines };
    })
    .sort((a, b) => b.doc.date.getTime() - a.doc.date.getTime() || b.doc.createdAt.getTime() - a.doc.createdAt.getTime());

  const todasLasFilas = rows.filter((r) => {
    if (pagoFilter === "pagado") return r.pagado;
    if (pagoFilter === "sin_pagar") return !r.pagado;
    return true;
  });
  // Sin filtro, lo último: es lo que se mira para ver si una entrega ya se cargó. Para más, se filtra.
  const filteredRows = hayFiltro ? todasLasFilas : todasLasFilas.slice(0, 60);
  const sinCobrar = rows.filter((r) => !r.pagado).length;

  const { hoy, ayer, atajos } = diasDeReferencia();
  const conFiltros = (extra: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, pago: pagoFilter, from, to, ...extra })) if (v) qs.set(k, v);
    const t = qs.toString();
    return t ? `/entregas?${t}` : "/entregas";
  };
  const sumarPorMoneda = (lista: typeof filteredRows) => {
    const m = new Map<Currency, Prisma.Decimal>();
    for (const r of lista) m.set(r.doc.currency, (m.get(r.doc.currency) ?? ZERO).plus(r.doc.totalAmount));
    return Array.from(m.entries())
      .sort(([a]) => (a === "ARS" ? -1 : 1))
      .map(([moneda, monto]) => formatMoney(monto, moneda))
      .join(" + ");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">Entregas</h1>
          <p className="text-sm text-foreground/60">
            {hayFiltro
              ? `${filteredRows.length} ${filteredRows.length === 1 ? "entrega" : "entregas"} · ${sumarPorMoneda(filteredRows) || formatMoney(0)}`
              : `Las últimas ${filteredRows.length} entregas`}
            {sinCobrar > 0 && !hayFiltro && (
              <>
                {" · "}
                <Link href="/entregas?pago=sin_pagar" className="text-amber-700 underline-offset-2 hover:underline dark:text-amber-400">
                  {sinCobrar} sin cobrar
                </Link>
              </>
            )}
          </p>
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

      <FilterBar limpiarHref="/entregas" hayFiltro={hayFiltro}>
        <FiltroBuscar defaultValue={q} placeholder="Cliente o número de remito…" />
        <FiltroSelect
          label="Cobro"
          name="pago"
          defaultValue={pagoFilter}
          opciones={PAGO_FILTERS.filter((f) => f.value).map((f) => ({ value: f.value, label: f.label === "Pagado" ? "Cobrado" : "Sin cobrar" }))}
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

      <div className="space-y-2">
        {agruparPorDia(filteredRows, (r) => r.doc.date).map(([d, delDia]) => (
          <DiaPlegable
            key={d}
            titulo={tituloDelDia(d, hoy, ayer)}
            cantidad={`${delDia.length} ${delDia.length === 1 ? "entrega" : "entregas"}`}
            nombres={delDia.map((r) => r.doc.account.entity.name)}
            pendientes={delDia.some((r) => !r.pagado) ? `${delDia.filter((r) => !r.pagado).length} sin cobrar` : null}
            subtotal={sumarPorMoneda(delDia)}
          >
              {delDia.map(({ doc, pendiente, defaultLines }) => (
                <div key={doc.id} className="flex items-center gap-3 px-4 py-3 first:rounded-t-xl last:rounded-b-xl">
                  <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-xs font-semibold text-foreground/60 sm:flex">
                    {iniciales(doc.account.entity.name)}
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
                      <span className={ETIQUETA}>Remito #{doc.number}</span>
                      <span className={ETIQUETA}>{formatLineasDeRemito(doc.lines)}</span>
                      <span className={ETIQUETA}>{CIRCUIT_LABELS[doc.account.circuit].split(" (")[0]}</span>
                      {(doc.entrega || doc.destinatario) && (
                        <span className={ETIQUETA_DESTACADA}>
                          {[doc.entrega?.nombre, doc.destinatario?.nombre].filter(Boolean).join(" — ")}
                        </span>
                      )}
                      <EstadoDePago pendiente={pendiente} total={doc.totalAmount} moneda={doc.currency} verbo="Cobrado" />
                      {pendiente.greaterThan(0.005) && doc.dueDate && (
                        <span
                          className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs ${
                            doc.dueDate < hoyComoFecha()
                              ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                              : "bg-foreground/[0.05] text-foreground/60"
                          }`}
                        >
                          {doc.dueDate < hoyComoFecha() ? "venció" : "vence"} el {formatFecha(doc.dueDate)}
                        </span>
                      )}
                    </div>
                    {/* Qué se llevó, por formato: el detalle completo está en el remito. */}
                    <p className="mt-1 truncate text-xs text-foreground/50">
                      {doc.lines
                        .map((l) => `${l.product.name} ${l.product.presentation} × ${formatLineasDeRemito([l])}`)
                        .join(" · ")}
                    </p>
                  </div>
                  <p className="hidden shrink-0 text-right text-lg font-semibold tabular-nums sm:block">
                    {formatMoney(doc.totalAmount, doc.currency)}
                  </p>
                  {canEdit && (
                    <div className="flex shrink-0 items-center">
                      <FormModal
                        triggerLabel="Editar"
                        soloIcono
                        iconName="edit"
                        title="Editar remito"
                        action={updateRemito}
                        maxWidthClass="max-w-5xl"
                      >
                        <RemitoFormFields
                          entityId={doc.account.entityId}
                          moneda={doc.account.entity.moneda}
                          products={products}
                          priceMapByCircuit={pricesByEntity[doc.account.entityId] ?? { BLANCO: {}, NEGRO: {} }}
                          editingDocumentId={doc.id}
                          defaultValues={{
                            number: doc.number,
                            date: toDateInputValue(doc.date),
                            dueDate: doc.dueDate ? toDateInputValue(doc.dueDate) : undefined,
                            currency: doc.currency,
                            exchangeRate: formatNumeroExacto(doc.exchangeRate),
                            entregaId: doc.entregaId,
                            destinatarioId: doc.destinatarioId,
                          }}
                          defaultLines={defaultLines}
                          viajes={viajesByEntity.get(doc.account.entityId)}
                          destinatarios={destinatariosByEntity.get(doc.account.entityId)}
                        />
                      </FormModal>
                      <DeleteButton
                        action={deleteRemito}
                        hiddenName="documentId"
                        hiddenValue={doc.id}
                        nombre={`el remito #${doc.number}`}
                      />
                    </div>
                  )}
                </div>
              ))}
          </DiaPlegable>
        ))}
        {filteredRows.length === 0 && (
          <p className="rounded-xl border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/40">
            {hayFiltro ? "No hay entregas con este filtro." : "Todavía no hay entregas cargadas."}
          </p>
        )}
      </div>
    </div>
  );
}
