import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import {
  getEntitySaldos,
  getUltimaCotizacion,
  separarRetiroSocietario,
  sumarSaldosEnPesos,
} from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { rubroLabel } from "@/lib/rubro-proveedor";
import { FormModal } from "@/components/Modal";
import { EntityFormFields } from "@/components/EntityFormFields";
import { FilterBar, FiltroBuscar, FiltroSelect } from "@/components/ui/FilterBar";
import { ORDENES, ordenarFilas } from "@/lib/orden-saldos";
import { Table, TableEmpty, Td, Th, Thead, Tr } from "@/components/ui/Table";
import { createEntity } from "../clientes/actions";

const TYPE_LABELS: Record<string, string> = {
  CLIENTE: "Cliente",
  PROVEEDOR: "Proveedor",
  AMBOS: "Cliente y proveedor",
};

const SALDO_FILTERS = [
  { value: "deuda", label: "Le debemos" },
  { value: "favor", label: "A favor nuestro" },
  { value: "cero", label: "En cero" },
];

export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; saldo?: string; rubro?: string; orden?: string }>;
}) {
  const { q, saldo, rubro, orden } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [todos, cotizacion] = await Promise.all([
    getEntitySaldos(["PROVEEDOR", "AMBOS"]),
    getUltimaCotizacion(),
  ]);

  const busqueda = q?.trim().toLowerCase();
  const saldoFiltro = SALDO_FILTERS.some((f) => f.value === saldo) ? saldo : "";
  const hayFiltro = Boolean(busqueda || saldoFiltro || rubro || orden);

  // Los rubros que de verdad hay cargados, no la lista entera de categorías posibles: un filtro
  // con veinte opciones de las que quince no devuelven nada no ayuda a nadie.
  const rubrosUsados = Array.from(
    new Set(todos.map(({ entity }) => rubroLabel(entity)).filter((r): r is string => Boolean(r)))
  ).sort((a, b) => a.localeCompare(b, "es"));

  const rows = todos
    .filter(
      ({ entity }) =>
        !busqueda ||
        entity.name.toLowerCase().includes(busqueda) ||
        (entity.taxId ?? "").toLowerCase().includes(busqueda)
    )
    .filter(({ entity }) => !rubro || rubroLabel(entity) === rubro)
    .filter(({ total }) => {
      if (saldoFiltro === "deuda") return total > 0;
      if (saldoFiltro === "favor") return total < 0;
      if (saldoFiltro === "cero") return total === 0;
      return true;
    });

  const filas = ordenarFilas(rows, orden);

  // El saldo a favor de la cuenta por la que se retira para los socios no es deuda: ver
  // separarRetiroSocietario. Sin esto el total de arriba la restaría y mostraría menos de lo que
  // de verdad se les debe a los proveedores.
  const { deuda } = separarRetiroSocietario(rows);
  const { total: deudaTotal, dolaresSinValuar } = sumarSaldosEnPesos(deuda, cotizacion);
  const conDeuda = rows.filter((r) => r.total > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">Proveedores</h1>
          <p className="text-sm text-foreground/60">
            {rows.length} {rows.length === 1 ? "proveedor" : "proveedores"} ·{" "}
            {conDeuda > 0 ? (
              <>
                {conDeuda} con saldo por{" "}
                <span className="font-medium text-foreground/80">
                  {formatMoney(deudaTotal)}
                  {!dolaresSinValuar.isZero() && ` + ${formatMoney(dolaresSinValuar, "USD")}`}
                </span>
              </>
            ) : (
              "ninguno con saldo"
            )}
          </p>
        </div>
        {canEdit && (
          <FormModal triggerLabel="Nuevo proveedor" title="Nuevo proveedor" action={createEntity}>
            <EntityFormFields defaultType="PROVEEDOR" showSupplierCategory />
          </FormModal>
        )}
      </div>

      <FilterBar limpiarHref="/proveedores" hayFiltro={hayFiltro} textoBoton="Filtrar">
        <FiltroBuscar defaultValue={q} placeholder="Nombre o CUIT…" />
        <FiltroSelect
          label="Rubro"
          name="rubro"
          defaultValue={rubro}
          opciones={rubrosUsados.map((r) => ({ value: r, label: r }))}
        />
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
          <Th secundaria>Rubro</Th>
          <Th secundaria>CUIT</Th>
          <Th secundaria align="derecha">
            Saldo Blanco
          </Th>
          <Th secundaria align="derecha">
            Saldo Negro
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
                <span className="block text-xs text-foreground/50 md:hidden">
                  {[rubroLabel(entity), entity.taxId].filter(Boolean).join(" · ") || "sin rubro"}
                </span>
              </Td>
              <Td secundaria>{TYPE_LABELS[entity.type]}</Td>
              <Td secundaria>{rubroLabel(entity) ?? "—"}</Td>
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
            <TableEmpty colSpan={7}>
              {hayFiltro
                ? "No hay proveedores con este filtro."
                : "Todavía no hay proveedores cargados."}
            </TableEmpty>
          )}
        </tbody>
      </Table>
    </div>
  );
}
