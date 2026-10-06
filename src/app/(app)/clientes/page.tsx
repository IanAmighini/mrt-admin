import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { getEntitySaldos, getUltimaCotizacion, sumarSaldosEnPesos } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { FormModal } from "@/components/Modal";
import { EntityFormFields } from "@/components/EntityFormFields";
import { FilterBar, FiltroBuscar, FiltroSelect } from "@/components/ui/FilterBar";
import { ORDENES, ordenarFilas } from "@/lib/orden-saldos";
import { Table, TableEmpty, Td, Th, Thead, Tr } from "@/components/ui/Table";
import { createEntity } from "./actions";

const TYPE_LABELS: Record<string, string> = {
  CLIENTE: "Cliente",
  PROVEEDOR: "Proveedor",
  AMBOS: "Cliente y proveedor",
};

/** Los tres estados en que puede estar una cuenta, que es como se la busca. */
const SALDO_FILTERS = [
  { value: "deuda", label: "Nos deben" },
  { value: "favor", label: "A favor" },
  { value: "cero", label: "En cero" },
];

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; saldo?: string; orden?: string }>;
}) {
  const { q, saldo, orden } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [todos, cotizacion] = await Promise.all([
    getEntitySaldos(["CLIENTE", "AMBOS"]),
    getUltimaCotizacion(),
  ]);

  const busqueda = q?.trim().toLowerCase();
  const saldoFiltro = SALDO_FILTERS.some((f) => f.value === saldo) ? saldo : "";
  const hayFiltro = Boolean(busqueda || saldoFiltro || orden);

  const rows = todos
    .filter(
      ({ entity }) =>
        !busqueda ||
        entity.name.toLowerCase().includes(busqueda) ||
        (entity.taxId ?? "").toLowerCase().includes(busqueda)
    )
    .filter(({ total }) => {
      if (saldoFiltro === "deuda") return total > 0;
      if (saldoFiltro === "favor") return total < 0;
      if (saldoFiltro === "cero") return total === 0;
      return true;
    });

  const filas = ordenarFilas(rows, orden);

  const { total: deudaTotal, dolaresSinValuar } = sumarSaldosEnPesos(rows, cotizacion);
  const conDeuda = rows.filter((r) => r.total > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">Clientes</h1>
          <p className="text-sm text-foreground/60">
            {rows.length} {rows.length === 1 ? "cliente" : "clientes"} ·{" "}
            {conDeuda > 0 ? (
              <>
                {conDeuda} con deuda por{" "}
                <span className="font-medium text-foreground/80">
                  {formatMoney(deudaTotal)}
                  {!dolaresSinValuar.isZero() && ` + ${formatMoney(dolaresSinValuar, "USD")}`}
                </span>
              </>
            ) : (
              "ninguno con deuda"
            )}
          </p>
        </div>
        {canEdit && (
          <FormModal triggerLabel="Nuevo cliente" title="Nuevo cliente" action={createEntity}>
            <EntityFormFields defaultType="CLIENTE" />
          </FormModal>
        )}
      </div>

      <FilterBar limpiarHref="/clientes" hayFiltro={hayFiltro} textoBoton="Filtrar">
        <FiltroBuscar defaultValue={q} placeholder="Nombre o CUIT…" />
        <FiltroSelect label="Saldo" name="saldo" defaultValue={saldoFiltro} opciones={SALDO_FILTERS} />
        <FiltroSelect
          label="Ordenar por"
          name="orden"
          defaultValue={orden}
          todos="Nombre (A-Z)"
          className="w-full sm:w-56"
          opciones={ORDENES.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
        />
      </FilterBar>

      <Table>
        <Thead>
          <Th>Nombre</Th>
          <Th secundaria>Tipo</Th>
          <Th secundaria>CUIT</Th>
          <Th secundaria align="derecha">
            Cuenta 1 (c/factura)
          </Th>
          <Th secundaria align="derecha">
            Cuenta 2 (s/factura)
          </Th>
          <Th align="derecha">Total</Th>
        </Thead>
        <tbody>
          {filas.map(({ entity, blancoSaldo, negroSaldo, total }) => (
            <Tr key={entity.id}>
              <Td>
                <Link
                  href={`/cuentas-corrientes/${entity.slug}`}
                  className="underline underline-offset-2"
                >
                  {entity.name}
                </Link>
                {/* En el teléfono las otras columnas no están, así que el CUIT va acá abajo. */}
                {entity.taxId && (
                  <span className="block text-xs text-foreground/50 md:hidden">{entity.taxId}</span>
                )}
              </Td>
              <Td secundaria>{TYPE_LABELS[entity.type]}</Td>
              <Td secundaria>{entity.taxId || "—"}</Td>
              <Td secundaria numero>
                {blancoSaldo ? formatMoney(blancoSaldo, entity.moneda) : "—"}
              </Td>
              <Td secundaria numero>
                {negroSaldo ? formatMoney(negroSaldo, entity.moneda) : "—"}
              </Td>
              <Td numero className={total < 0 ? "font-medium text-green-700 dark:text-green-400" : "font-medium"}>
                {formatMoney(total, entity.moneda)}
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <TableEmpty colSpan={6}>
              {hayFiltro ? "No hay clientes con este filtro." : "Todavía no hay clientes cargados."}
            </TableEmpty>
          )}
        </tbody>
      </Table>
    </div>
  );
}
