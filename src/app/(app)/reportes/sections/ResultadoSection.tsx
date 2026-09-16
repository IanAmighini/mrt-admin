import { Prisma } from "@prisma/client";
import { TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { formatMoney, ZERO } from "@/lib/money";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { getResultadoReport } from "@/lib/reports";
import type { Period } from "@/lib/period";

/** Porcentaje que representa `parte` de `total`, o null si no hay contra qué compararlo. */
function porcentaje(parte: Prisma.Decimal, total: Prisma.Decimal): string | null {
  if (total.isZero()) return null;
  return `${parte.dividedBy(total).times(100).toFixed(1).replace(".", ",")}%`;
}

export async function ResultadoSection({ period }: { period: Period }) {
  const report = await getResultadoReport(period);
  const enRojo = report.resultado.lessThan(0);
  const margen = porcentaje(report.resultado, report.ventas);

  // La cascada: cada renglón con lo que suma o resta, y los dos subtotales destacados.
  const filas = [
    { label: "Ventas netas", monto: report.ventas, tipo: "suma" as const },
    { label: "Costo de insumos", monto: report.costoInsumos.negated(), tipo: "resta" as const },
    { label: "Margen bruto", monto: report.margenBruto, tipo: "subtotal" as const },
    { label: "Gastos", monto: report.gastos.negated(), tipo: "resta" as const },
    { label: "Resultado", monto: report.resultado, tipo: "total" as const },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Resultado del período"
          value={formatMoney(report.resultado)}
          icon={enRojo ? TrendingDown : TrendingUp}
          color={enRojo ? "red" : "green"}
        />
        <KpiCard label="Ventas netas" value={formatMoney(report.ventas)} icon={Wallet} color="blue" />
        <KpiCard
          label="Margen sobre ventas"
          value={margen ?? "—"}
          icon={enRojo ? TrendingDown : TrendingUp}
          color="amber"
        />
      </div>

      <section className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5">
        <h2 className="text-sm font-semibold mb-3">Cómo se llega</h2>
        <div className="space-y-1">
          {filas.map((f) => (
            <div
              key={f.label}
              className={`flex items-baseline justify-between gap-4 py-1.5 ${
                f.tipo === "subtotal" || f.tipo === "total"
                  ? "border-t border-foreground/10 font-semibold"
                  : ""
              }`}
            >
              <span className={f.tipo === "resta" ? "text-foreground/60" : ""}>
                {f.tipo === "resta" ? "− " : ""}
                {f.label}
              </span>
              <span
                className={`tabular-nums ${f.tipo === "total" ? "text-lg" : ""} ${
                  f.monto.lessThan(0) && f.tipo !== "resta" ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {formatMoney(f.tipo === "resta" ? f.monto.negated() : f.monto)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-foreground/50">
          Todo en pesos y neto de IVA: el IVA se cobra y se deposita, así que no es ingreso ni
          costo. Las cuentas en dólares quedan afuera — valuarlas necesitaría una cotización por
          comprobante y el número dejaría de ser comparable contra el mes anterior.
        </p>
        {report.avisos.itemsSinCosto > 0 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {report.avisos.itemsSinCosto} insumo(s) consumido(s) no tienen costo unitario cargado,
            así que no se descontaron: el resultado está mejor de lo que es.
          </p>
        )}
        {report.avisos.facturasSinCompra.count > 0 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Hay {report.avisos.facturasSinCompra.count} factura(s) de proveedor por{" "}
            {formatMoney(report.avisos.facturasSinCompra.total)} sin una compra vinculada, así que
            ese costo tampoco está descontado.
          </p>
        )}
      </section>

      {report.retiros.length > 0 && (
        <section className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5">
          <h2 className="text-sm font-semibold mb-1">Retiros societarios</h2>
          <div className="space-y-1">
            {report.retiros.map((r) => (
              <div key={r.nombre} className="flex items-baseline justify-between gap-4">
                <span className="text-foreground/60">
                  {r.nombre}
                  <span className="block text-xs text-foreground/50">
                    acumulado: {formatMoney(r.acumulado, r.moneda)}
                  </span>
                </span>
                <span className="tabular-nums font-semibold">
                  {formatMoney(r.delPeriodo, r.moneda)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-foreground/50">
            Lo que se le dio de más <strong>en este período</strong>: cuánto creció el saldo a favor
            nuestro en esa cuenta. Lo que se le pagó de lo que sí se le debía no cuenta — eso es
            cancelar una deuda, no retirar. No resta del resultado, porque un retiro es reparto de lo
            ganado y no un costo de producir. Va en su moneda, sin convertir.
          </p>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2">En qué se fueron los gastos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Rubro</th>
                <th className="py-2 pr-4 text-right">Importe</th>
                <th className="py-2 pr-4 text-right">Del total</th>
              </tr>
            </thead>
            <tbody>
              {report.porRubro.map((r) => (
                <tr key={r.category ?? "sin-rubro"} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">
                    {r.category ? EXPENSE_CATEGORY_LABELS[r.category] : "Sin rubro"}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(r.total)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-foreground/60">
                    {porcentaje(r.total, report.gastos) ?? "—"}
                  </td>
                </tr>
              ))}
              {report.porRubro.length === 0 && (
                <tr>
                  <td className="py-4 text-foreground/40" colSpan={3}>
                    No hay gastos cargados en este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Mes a mes</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Mes</th>
                <th className="py-2 pr-4 text-right">Ventas</th>
                <th className="py-2 pr-4 text-right">Insumos</th>
                <th className="py-2 pr-4 text-right">Gastos</th>
                <th className="py-2 pr-4 text-right">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {report.meses.map((m) => (
                <tr key={m.from.toISOString()} className="border-b border-foreground/5">
                  <td className="py-2 pr-4 capitalize">{m.label}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(m.ventas)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-foreground/60">
                    {formatMoney(m.costoInsumos)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-foreground/60">
                    {formatMoney(m.gastos)}
                  </td>
                  <td
                    className={`py-2 pr-4 text-right font-medium tabular-nums ${
                      m.resultado.lessThan(ZERO) ? "text-red-600 dark:text-red-400" : ""
                    }`}
                  >
                    {formatMoney(m.resultado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-foreground/50">
          Los seis meses hasta el del período elegido, cada uno con su propia cuenta. Un mes con
          poca carga se ve mejor de lo que fue: el resultado sólo vale lo que valga lo cargado.
        </p>
      </section>
    </div>
  );
}
