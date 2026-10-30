import Link from "next/link";
import { Send, Users, Wallet } from "lucide-react";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney, formatQuantity } from "@/lib/money";
import { formatFecha, formatPeriodLabel, hoyComoFecha, periodFromSearchParams } from "@/lib/period";
import { getDashboardClientes } from "@/lib/dashboards";
import { KpiCard } from "@/components/KpiCard";
import { Tarjeta } from "@/components/ui/Tarjeta";
import { PeriodoFilter } from "@/components/ui/PeriodoFilter";
import { BarraDeTramos, Barras, ColumnasPorSemana, millones, type Color } from "@/components/dashboard/Graficos";

const COLOR_DEL_TRAMO: Record<string, Color> = {
  "No venció": "azul",
  "1 a 30 días": "amarillo",
  "31 a 60 días": "naranja",
  "Más de 60 días": "rojo",
  "Anterior a la app": "gris",
};

/**
 * Cómo vienen los clientes: lo que deben y desde cuándo, quiénes, y lo entregado contra lo cobrado.
 * Lo que se debe es de hoy; lo entregado y lo cobrado, del período elegido. Las listas de últimas
 * entregas y cobros se sacaron: viven en sus pantallas. El resultado del mes está en el Cierre.
 */
export default async function DashboardClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requireRole(["ADMIN", "SOLO_LECTURA"]);
  const sp = await searchParams;
  const { period, preset } = periodFromSearchParams(sp);
  const d = await getDashboardClientes(period);
  const hoy = formatFecha(hoyComoFecha());
  const cobradoSobreEntregado = d.entregado.pesos.isZero()
    ? null
    : d.cobrado.dividedBy(d.entregado.pesos).times(100).toDecimalPlaces(0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Dashboard Clientes</h1>
          <p className="text-sm text-foreground/60">{formatPeriodLabel(period)}</p>
        </div>
        <PeriodoFilter basePath="/dashboard-clientes" preset={preset} from={sp.from} to={sp.to} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label={`Nos deben, al ${hoy}`}
          value={formatMoney(d.nosDeben.toDecimalPlaces(0))}
          caption={
            d.comprobantesVencidos > 0
              ? `${millones(d.vencido)} vencido, en ${d.comprobantesVencidos} comprobantes`
              : "nada vencido"
          }
          icon={Users}
          color="red"
        />
        <KpiCard
          label="Entregado"
          value={formatMoney(d.entregado.pesos.toDecimalPlaces(0))}
          caption={`${formatQuantity(d.entregado.pallets.toDecimalPlaces(0))} pallets · ${formatQuantity(d.entregado.litros.toDecimalPlaces(0), "L")}`}
          icon={Send}
          color="blue"
        />
        <KpiCard
          label="Cobrado"
          value={formatMoney(d.cobrado.toDecimalPlaces(0))}
          caption={cobradoSobreEntregado ? `${formatQuantity(cobradoSobreEntregado)}% de lo entregado` : undefined}
          icon={Wallet}
          color="green"
        />
      </div>

      <Tarjeta
        titulo={`Lo que nos deben, por antigüedad, al ${hoy}`}
        resumen={
          d.vencido.greaterThan(0)
            ? `${millones(d.vencido)} vencido. Lo anterior a la app es el saldo inicial que todavía se debe.`
            : "Nada vencido."
        }
        href="/reportes?report=remitos-vencidos"
        alerta={d.vencido.greaterThan(0)}
      >
        <div className="pt-1">
          <BarraDeTramos tramos={d.antiguedad.map((t) => ({ nombre: t.tramo, valor: t.monto, color: COLOR_DEL_TRAMO[t.tramo] }))} />
        </div>
      </Tarjeta>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta
          titulo="Quiénes deben"
          resumen={`${d.cantidadDeudores} ${d.cantidadDeudores === 1 ? "cliente" : "clientes"} · en rojo, lo vencido`}
          href="/clientes?saldo=deuda"
        >
          <div className="pt-1">
            <Barras
              filas={d.deudores.map((c) => ({
                clave: c.slug,
                nombre: c.nombre,
                href: `/cuentas-corrientes/${c.slug}`,
                valor: c.total,
                partes: [
                  { nombre: "No venció", valor: c.total.minus(c.vencido), color: "azul" },
                  { nombre: "Vencido", valor: c.vencido, color: "rojo" },
                ],
              }))}
            />
          </div>
        </Tarjeta>

        <Tarjeta titulo="Entregado y cobrado, por semana" resumen="Las últimas semanas, de lunes a domingo" href="/pagos-clientes">
          <div className="pt-1">
            <ColumnasPorSemana
              semanas={d.semanas.map((s) => ({ desde: s.desde, valores: [s.entregado, s.cobrado] }))}
              series={[
                { nombre: "Entregado", color: "azul" },
                { nombre: "Cobrado", color: "verde" },
              ]}
            />
          </div>
        </Tarjeta>
      </div>

      <Tarjeta titulo="Entregado por marca" resumen={formatPeriodLabel(period)} href="/reportes?report=ventas">
        <div className="pt-1">
          <Barras
            filas={d.porMarca.map((m) => ({
              clave: m.marca,
              nombre: m.marca,
              detalle: `${formatQuantity(m.pallets.toDecimalPlaces(0))} pallets`,
              valor: m.pesos,
            }))}
          />
        </div>
      </Tarjeta>

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
