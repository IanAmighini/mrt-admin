import { requireUser } from "@/lib/auth-helpers";
import { getEntitySaldos, getUltimaCotizacion, sumarSaldosEnPesos } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { rubroLabel } from "@/lib/rubro-proveedor";
import { FormModal } from "@/components/Modal";
import { EntityFormFields } from "@/components/EntityFormFields";
import { FilterBar, FiltroBuscar, FiltroSelect } from "@/components/ui/FilterBar";
import { CuentasAlDia, FilasDeCuentas, TarjetasDeSaldo, hrefConSaldo } from "@/components/CuentasLista";
import { ORDENES, ordenarFilas } from "@/lib/orden-saldos";
import { createEntity } from "../clientes/actions";

const SALDOS = ["deuda", "favor", "cero"] as const;

export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; saldo?: string; rubro?: string; orden?: string }>;
}) {
  const { q, saldo, rubro, orden } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [todos, cotizacionDecimal] = await Promise.all([
    getEntitySaldos(["PROVEEDOR", "AMBOS"]),
    getUltimaCotizacion(),
  ]);
  const cotizacion = cotizacionDecimal?.toNumber() ?? null;

  const busqueda = q?.trim().toLowerCase();
  const saldoFiltro = (SALDOS as readonly string[]).includes(saldo ?? "") ? saldo! : "";
  const hayFiltro = Boolean(busqueda || saldoFiltro || rubro || orden);

  // Los rubros que de verdad hay cargados, no la lista entera de categorías posibles: un filtro
  // con veinte opciones de las que quince no devuelven nada no ayuda a nadie.
  const rubrosUsados = Array.from(
    new Set(todos.map(({ entity }) => rubroLabel(entity)).filter((r): r is string => Boolean(r)))
  ).sort((a, b) => a.localeCompare(b, "es"));

  // Las tarjetas cuentan sobre lo buscado, sin el filtro de saldo: si no, al tocar "Le debemos"
  // las otras quedarían en cero.
  const buscados = todos
    .filter(
      ({ entity }) =>
        !busqueda || entity.name.toLowerCase().includes(busqueda) || (entity.taxId ?? "").toLowerCase().includes(busqueda)
    )
    .filter(({ entity }) => !rubro || rubroLabel(entity) === rubro);

  // El saldo a favor de la cuenta por la que se retira para los socios no es plata que el
  // proveedor nos deba: no suma a "A favor nuestro" ni tiene tarjeta propia.
  const esRetiro = (r: (typeof todos)[number]) => r.entity.retiroSocietario && r.total < 0;
  const debemos = buscados.filter((r) => r.total > 0);
  const aFavor = buscados.filter((r) => r.total < 0 && !esRetiro(r));
  const retiros = buscados.filter(esRetiro);
  const enCero = buscados.filter((r) => r.total === 0);

  const conSaldo = ordenarFilas(
    saldoFiltro === "deuda"
      ? debemos
      : saldoFiltro === "favor"
        ? aFavor
        : saldoFiltro === "cero"
          ? []
          : [...debemos, ...aFavor, ...retiros],
    orden,
    cotizacion
  );
  const enPesos = (r: (typeof todos)[number]) => (r.entity.moneda === "USD" && cotizacion ? r.total * cotizacion : r.total);
  const maximo = Math.max(0, ...debemos.map(enPesos));

  const totalDebemos = sumarSaldosEnPesos(debemos, cotizacionDecimal);
  const totalFavor = sumarSaldosEnPesos(aFavor, cotizacionDecimal);
  const params = { q, rubro, orden };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold mb-1">Proveedores</h1>
          <p className="text-sm text-foreground/60">
            {todos.length} proveedores. Tocá una tarjeta para ver sólo esos.
          </p>
        </div>
        {canEdit && (
          <FormModal triggerLabel="Nuevo proveedor" title="Nuevo proveedor" action={createEntity}>
            <EntityFormFields defaultType="PROVEEDOR" showSupplierCategory />
          </FormModal>
        )}
      </div>

      <TarjetasDeSaldo
        tarjetas={[
          {
            label: "Le debemos",
            cantidad: debemos.length,
            valor:
              formatMoney(totalDebemos.total) +
              (totalDebemos.dolaresSinValuar.isZero() ? "" : ` + ${formatMoney(totalDebemos.dolaresSinValuar, "USD")}`),
            detalle: debemos.some((r) => r.entity.moneda === "USD") && cotizacion ? `dólares a ${formatMoney(cotizacion)}` : undefined,
            href: hrefConSaldo("/proveedores", params, "deuda", saldoFiltro),
            activa: saldoFiltro === "deuda",
            tono: "deuda",
          },
          {
            label: "A favor nuestro",
            cantidad: aFavor.length,
            valor:
              formatMoney(totalFavor.total.negated()) +
              (totalFavor.dolaresSinValuar.isZero() ? "" : ` + ${formatMoney(totalFavor.dolaresSinValuar.negated(), "USD")}`),
            href: hrefConSaldo("/proveedores", params, "favor", saldoFiltro),
            activa: saldoFiltro === "favor",
            tono: "favor",
          },
          {
            label: "Al día",
            cantidad: enCero.length,
            href: hrefConSaldo("/proveedores", params, "cero", saldoFiltro),
            activa: saldoFiltro === "cero",
          },
        ]}
      />

      <FilterBar limpiarHref="/proveedores" hayFiltro={hayFiltro} textoBoton="Filtrar">
        {saldoFiltro && <input type="hidden" name="saldo" value={saldoFiltro} />}
        <FiltroBuscar defaultValue={q} placeholder="Nombre o CUIT…" />
        <FiltroSelect
          label="Rubro"
          name="rubro"
          defaultValue={rubro}
          opciones={rubrosUsados.map((r) => ({ value: r, label: r }))}
        />
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
          etiquetaFavor={(f) =>
            todos.find((r) => r.entity.id === f.entity.id)?.entity.retiroSocietario ? "retiro societario" : "a favor nuestro"
          }
          extra={(f) => {
            const r = rubroLabel(todos.find((x) => x.entity.id === f.entity.id)!.entity);
            return r ? (
              <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[11px] text-foreground/70">{r}</span>
            ) : null;
          }}
        />
      )}
      {(saldoFiltro === "" || saldoFiltro === "cero") && <CuentasAlDia filas={enCero} />}
      {conSaldo.length === 0 && (saldoFiltro === "deuda" || saldoFiltro === "favor" || enCero.length === 0) && (
        <p className="rounded-xl border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/40">
          {hayFiltro ? "No hay proveedores con este filtro." : "Todavía no hay proveedores cargados."}
        </p>
      )}
    </div>
  );
}
