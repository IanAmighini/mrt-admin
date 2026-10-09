import { requireUser } from "@/lib/auth-helpers";
import { getEntitySaldos, getUltimaCotizacion, sumarSaldosEnPesos } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { FormModal } from "@/components/Modal";
import { EntityFormFields } from "@/components/EntityFormFields";
import { FilterBar, FiltroBuscar, FiltroSelect } from "@/components/ui/FilterBar";
import { CuentasAlDia, FilasDeCuentas, TarjetasDeSaldo, hrefConSaldo } from "@/components/CuentasLista";
import { ORDENES, ordenarFilas } from "@/lib/orden-saldos";
import { createEntity } from "./actions";

/** Los tres estados en que puede estar una cuenta, que es como se la busca. */
const SALDOS = ["deuda", "favor", "cero"] as const;

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; saldo?: string; orden?: string }>;
}) {
  const { q, saldo, orden } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [todos, cotizacionDecimal] = await Promise.all([
    getEntitySaldos(["CLIENTE", "AMBOS"]),
    getUltimaCotizacion(),
  ]);
  const cotizacion = cotizacionDecimal?.toNumber() ?? null;

  const busqueda = q?.trim().toLowerCase();
  const saldoFiltro = (SALDOS as readonly string[]).includes(saldo ?? "") ? saldo! : "";
  const hayFiltro = Boolean(busqueda || saldoFiltro || orden);

  // Las tarjetas cuentan sobre lo buscado, sin el filtro de saldo: si no, al tocar "Nos deben"
  // las otras dos quedarían en cero.
  const buscados = todos.filter(
    ({ entity }) =>
      !busqueda || entity.name.toLowerCase().includes(busqueda) || (entity.taxId ?? "").toLowerCase().includes(busqueda)
  );
  const deben = buscados.filter((r) => r.total > 0);
  const aFavor = buscados.filter((r) => r.total < 0);
  const enCero = buscados.filter((r) => r.total === 0);

  const conSaldo = ordenarFilas(
    saldoFiltro === "deuda" ? deben : saldoFiltro === "favor" ? aFavor : saldoFiltro === "cero" ? [] : [...deben, ...aFavor],
    orden,
    cotizacion
  );
  const enPesos = (r: (typeof todos)[number]) => (r.entity.moneda === "USD" && cotizacion ? r.total * cotizacion : r.total);
  const maximo = Math.max(0, ...deben.map(enPesos));

  const totalDeben = sumarSaldosEnPesos(deben, cotizacionDecimal);
  const totalFavor = sumarSaldosEnPesos(aFavor, cotizacionDecimal);
  const params = { q, orden };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">Clientes</h1>
          <p className="text-sm text-foreground/60">
            {todos.length} clientes. Tocá una tarjeta para ver sólo esos.
          </p>
        </div>
        {canEdit && (
          <FormModal triggerLabel="Nuevo cliente" title="Nuevo cliente" action={createEntity}>
            <EntityFormFields defaultType="CLIENTE" />
          </FormModal>
        )}
      </div>

      <TarjetasDeSaldo
        tarjetas={[
          {
            label: "Nos deben",
            cantidad: deben.length,
            valor:
              formatMoney(totalDeben.total) +
              (totalDeben.dolaresSinValuar.isZero() ? "" : ` + ${formatMoney(totalDeben.dolaresSinValuar, "USD")}`),
            detalle: deben.some((r) => r.entity.moneda === "USD") && cotizacion ? `dólares a ${formatMoney(cotizacion)}` : undefined,
            href: hrefConSaldo("/clientes", params, "deuda", saldoFiltro),
            activa: saldoFiltro === "deuda",
            tono: "deuda",
          },
          {
            label: "A favor del cliente",
            cantidad: aFavor.length,
            valor:
              formatMoney(totalFavor.total.negated()) +
              (totalFavor.dolaresSinValuar.isZero() ? "" : ` + ${formatMoney(totalFavor.dolaresSinValuar.negated(), "USD")}`),
            href: hrefConSaldo("/clientes", params, "favor", saldoFiltro),
            activa: saldoFiltro === "favor",
            tono: "favor",
          },
          {
            label: "Al día",
            cantidad: enCero.length,
            href: hrefConSaldo("/clientes", params, "cero", saldoFiltro),
            activa: saldoFiltro === "cero",
          },
        ]}
      />

      <FilterBar limpiarHref="/clientes" hayFiltro={hayFiltro} textoBoton="Filtrar">
        {saldoFiltro && <input type="hidden" name="saldo" value={saldoFiltro} />}
        <FiltroBuscar defaultValue={q} placeholder="Nombre o CUIT…" />
        <FiltroSelect
          label="Ordenar por"
          name="orden"
          defaultValue={orden}
          todos={ORDENES[0].label}
          className="w-full sm:w-56"
          opciones={ORDENES.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
        />
      </FilterBar>

      {conSaldo.length > 0 && (
        <FilasDeCuentas
          filas={conSaldo}
          maximo={maximo}
          cotizacion={cotizacion}
          etiquetaFavor={() => "a favor del cliente"}
        />
      )}
      {(saldoFiltro === "" || saldoFiltro === "cero") && <CuentasAlDia filas={enCero} />}
      {conSaldo.length === 0 && (saldoFiltro === "deuda" || saldoFiltro === "favor" || enCero.length === 0) && (
        <p className="rounded-xl border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/40">
          {hayFiltro ? "No hay clientes con este filtro." : "Todavía no hay clientes cargados."}
        </p>
      )}
    </div>
  );
}
