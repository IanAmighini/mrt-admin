import Link from "next/link";
import { Banknote, Building2, ShoppingCart } from "lucide-react";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney } from "@/lib/money";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { formatFecha, formatPeriodLabel, hoyComoFecha, periodFromSearchParams } from "@/lib/period";
import { getDashboardProveedores } from "@/lib/dashboards";
import { KpiCard } from "@/components/KpiCard";
import { Renglon, Tarjeta } from "@/components/ui/Tarjeta";
import { PeriodoFilter } from "@/components/ui/PeriodoFilter";
import { Barras, millones, PreciosDeAceite, Referencia } from "@/components/dashboard/Graficos";

/**
 * Cómo vienen los proveedores: a quién se le debe y en qué cuenta, qué se compró, a cuánto se pagó
 * el aceite —casi todo el costo— y cuánto vale lo que hay en el depósito. Lo que se debe y el stock
 * son de hoy; lo comprado y lo pagado, del período elegido.
 */
export default async function DashboardProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireRole(["ADMIN", "SOLO_LECTURA"]);
  const sp = await searchParams;
  const { period, preset } = periodFromSearchParams(sp);
  const d = await getDashboardProveedores(period);
  const hoy = formatFecha(hoyComoFecha());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Dashboard Proveedores</h1>
          <p className="text-sm text-foreground/60">{formatPeriodLabel(period)}</p>
        </div>
        <PeriodoFilter basePath="/dashboard-proveedores" preset={preset} from={sp.from} to={sp.to} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label={`Les debemos, al ${hoy}`}
          value={formatMoney(d.lesDebemos.toDecimalPlaces(0))}
          caption={`a ${d.cantidadAcreedores} ${d.cantidadAcreedores === 1 ? "proveedor" : "proveedores"}, con los dólares a la última cotización`}
          icon={Building2}
          color="red"
        />
        <KpiCard
          label="Comprado en insumos"
          value={formatMoney(d.comprado.toDecimalPlaces(0))}
          caption={`neto de IVA · y ${millones(d.gastado)} de gastos`}
          icon={ShoppingCart}
          color="blue"
        />
        <KpiCard label="Pagado" value={formatMoney(d.pagado.toDecimalPlaces(0))} caption="a proveedores, de todas las cajas" icon={Banknote} color="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="A quiénes les debemos" resumen={`Al ${hoy}`} href="/proveedores?saldo=deuda">
          <div className="space-y-3 pt-1">
            <Referencia
              items={[
                { nombre: "Cuenta 1", color: "azul" },
                { nombre: "Cuenta 2", color: "naranja" },
              ]}
            />
            <Barras
              filas={d.acreedores.map((a) => ({
                clave: a.slug,
                nombre: a.nombre,
                href: `/cuentas-corrientes/${a.slug}`,
                valor: a.total,
                partes: [
                  { nombre: "Cuenta 1", valor: a.cuenta1, color: "azul" },
                  { nombre: "Cuenta 2", valor: a.cuenta2, color: "naranja" },
                ],
              }))}
            />
          </div>
        </Tarjeta>

        <Tarjeta
          titulo="Precio del aceite"
          resumen="U$S por tonelada, compra por compra, últimos 90 días"
          href="/reportes?report=compras"
        >
          <div className="pt-1">
            <PreciosDeAceite compras={d.aceite} />
          </div>
        </Tarjeta>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Comprado por tipo de insumo" resumen={formatPeriodLabel(period)} href="/reportes?report=compras">
          <div className="pt-1">
            <Barras
              filas={d.compradoPorTipo.map((c) => ({
                clave: c.categoria,
                nombre: SUPPLIER_CATEGORY_LABELS[c.categoria],
                valor: c.pesos,
              }))}
            />
          </div>
        </Tarjeta>

        <Tarjeta
          titulo={`Stock de insumos: ${formatMoney(d.stock.toDecimalPlaces(0))}`}
          resumen={`Al ${hoy}, a lo que costó la última compra`}
          href="/reportes?report=valorizacion-insumos"
        >
          <div className="pt-1">
            <Barras
              filas={d.stockPorCategoria.map((c) => ({
                clave: c.categoria,
                nombre: SUPPLIER_CATEGORY_LABELS[c.categoria],
                valor: c.valor,
              }))}
              colorPorDefecto="verde"
            />
          </div>
        </Tarjeta>
      </div>

      {d.retiros.length > 0 && (
        <Tarjeta
          titulo="Retiro societario"
          resumen="Lo que se llevaron los socios, acumulado: no es deuda de nadie"
          href="/reportes?report=cierre-mes"
        >
          {d.retiros.map((r) => (
            <Renglon key={r.nombre} izquierda={r.nombre} derecha={formatMoney(r.monto, r.moneda)} />
          ))}
        </Tarjeta>
      )}

      <p className="text-sm text-foreground/60">
        Si se ganó o se perdió plata está en{" "}
        <Link href="/reportes?report=cierre-mes" className="underline underline-offset-2">
          Reportes → Cierre del mes
        </Link>
        .
      </p>
    </div>
  );
}
