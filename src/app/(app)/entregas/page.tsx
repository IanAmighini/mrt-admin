import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getDocumentPending, getRecentRemitos } from "@/lib/ledger";
import { getAllCurrentPrices } from "@/lib/pricing";
import { formatMoney, formatNumeroExacto, formatQuantity, sumDecimals } from "@/lib/money";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { RemitoFormFields, lineaDeRemito } from "@/components/RemitoForm";
import { FilterBar, FiltroBuscar, FiltroFechas, FiltroSelect } from "@/components/ui/FilterBar";
import { Table, TableEmpty, Td, Th, Thead, Tr } from "@/components/ui/Table";
import { deleteRemito, updateRemito } from "../cuentas-corrientes/[entityId]/actions";
import { addDays, formatFecha, parseFecha, toDateInputValue } from "@/lib/period";

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

  const rows = remitos.map((doc) => {
    const pending = getDocumentPending(doc);
    const pallets = doc.lines.reduce((acc, l) => acc + l.quantity.toNumber(), 0);
    const defaultLines = doc.lines.map((l) => lineaDeRemito(l, doc.account.circuit));
    return { doc, pallets, pagado: pending.lessThanOrEqualTo(0), defaultLines };
  });

  const filteredRows = rows.filter((r) => {
    if (pagoFilter === "pagado") return r.pagado;
    if (pagoFilter === "sin_pagar") return !r.pagado;
    return true;
  });

  // Cuánto se entregó y cuánto falta cobrar de lo que se está viendo.
  const totalEntregado = sumDecimals(filteredRows.map((r) => r.doc.totalAmount));
  const totalPendiente = sumDecimals(filteredRows.map((r) => getDocumentPending(r.doc)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">Entregas</h1>
          <p className="text-sm text-foreground/60">
            {filteredRows.length} {filteredRows.length === 1 ? "entrega" : "entregas"} ·{" "}
            {formatMoney(totalEntregado)}
            {totalPendiente.greaterThan(0) && (
              <span className="text-amber-600 dark:text-amber-400">
                {" "}
                · {formatMoney(totalPendiente)} sin cobrar
              </span>
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
          opciones={PAGO_FILTERS.filter((f) => f.value).map((f) => ({ value: f.value, label: f.label }))}
        />
        <FiltroFechas from={from} to={to} />
      </FilterBar>

      <Table apilada>
        <Thead>
          <Th>Remito</Th>
          <Th>Cliente</Th>
          <Th>Fecha</Th>
          <Th align="derecha">Pallets</Th>
          <Th align="derecha">Total</Th>
          <Th>Pago</Th>
          {canEdit && <Th>Acciones</Th>}
        </Thead>
          <tbody>
            {filteredRows.map(({ doc, pallets, pagado, defaultLines }) => (
              <Tr key={doc.id}>
                <Td className="whitespace-nowrap">#{doc.number}</Td>
                <Td>
                  <Link
                    href={`/cuentas-corrientes/${doc.account.entity.slug}`}
                    className="underline underline-offset-2"
                  >
                    {doc.account.entity.name}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{formatFecha(doc.date)}</Td>
                <Td numero>{formatQuantity(pallets, "pallets")}</Td>
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
                      <FormModal
                        triggerLabel="Editar"
                        iconName="edit"
                        title="Editar remito"
                        action={updateRemito}
                        maxWidthClass="max-w-3xl"
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
                  </Td>
                )}
              </Tr>
            ))}
            {filteredRows.length === 0 && (
              <TableEmpty colSpan={canEdit ? 7 : 6}>
                {hayFiltro ? "No hay entregas con este filtro." : "Todavía no hay entregas cargadas."}
              </TableEmpty>
            )}
          </tbody>
        </Table>
    </div>
  );
}
