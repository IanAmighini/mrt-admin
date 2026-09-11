import Link from "next/link";
import { Building2, Percent, Receipt } from "lucide-react";
import { Prisma, type Currency } from "@prisma/client";
import { formatMoney, formatNumeroEditable, ZERO } from "@/lib/money";
import { CIRCUIT_LABELS, EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { getGastosReport } from "@/lib/reports";
import type { Period } from "@/lib/period";

function ars(byCurrency: Map<Currency, Prisma.Decimal>): Prisma.Decimal {
  return byCurrency.get("ARS") ?? ZERO;
}

export async function GastosSection({ period }: { period: Period }) {
  const report = await getGastosReport(period);
  const ivaTotal = report.porAlicuota.reduce((acc, a) => acc.plus(a.iva), ZERO);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Gastos del período" value={formatMoney(ars(report.totales))} icon={Receipt} color="red" />
        <KpiCard label="IVA crédito fiscal" value={formatMoney(ivaTotal)} icon={Percent} color="blue" />
        <KpiCard label="Proveedores" value={String(report.porProveedor.length)} icon={Building2} color="amber" />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Por rubro</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Rubro</th>
                <th className="py-2 pr-4">Comprobantes</th>
                <th className="py-2 pr-4">Importe</th>
              </tr>
            </thead>
            <tbody>
              {report.porRubro.map((r) => (
                <tr key={r.category} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">{EXPENSE_CATEGORY_LABELS[r.category]}</td>
                  <td className="py-2 pr-4">{r.count}</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(ars(r.byCurrency))}</td>
                </tr>
              ))}
              {report.porRubro.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-foreground/40">
                    Sin gastos en este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {report.porProveedor.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Por proveedor</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Proveedor</th>
                  <th className="py-2 pr-4">Comprobantes</th>
                  <th className="py-2 pr-4">Importe</th>
                </tr>
              </thead>
              <tbody>
                {report.porProveedor.map((p) => (
                  <tr key={p.entitySlug} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link href={`/cuentas-corrientes/${p.entitySlug}`} className="underline underline-offset-2">
                        {p.entityName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{p.count}</td>
                    <td className="py-2 pr-4 font-medium">{formatMoney(ars(p.byCurrency))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report.porAlicuota.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Por alícuota</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Alícuota</th>
                  <th className="py-2 pr-4">Neto gravado</th>
                  <th className="py-2 pr-4">IVA</th>
                </tr>
              </thead>
              <tbody>
                {report.porAlicuota.map((a) => (
                  <tr key={a.rate.toString()} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">{formatNumeroEditable(a.rate, 1)} %</td>
                    <td className="py-2 pr-4">{formatMoney(a.neto)}</td>
                    <td className="py-2 pr-4 font-medium">{formatMoney(a.iva)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report.detalle.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Detalle</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2 pr-4">Número</th>
                  <th className="py-2 pr-4">Proveedor</th>
                  <th className="py-2 pr-4">Rubro</th>
                  <th className="py-2 pr-4">Cuenta</th>
                  <th className="py-2 pr-4 text-right">Neto</th>
                  <th className="py-2 pr-4 text-right">IVA</th>
                  <th className="py-2 pr-4 text-right">Percepciones</th>
                  <th className="py-2 pr-4 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {report.detalle.map((d, i) => (
                  <tr key={`${d.number}-${i}`} className="border-b border-foreground/5">
                    <td className="py-2 pr-4 whitespace-nowrap">{d.date.toLocaleDateString("es-AR")}</td>
                    <td className="py-2 pr-4">{d.number}</td>
                    <td className="py-2 pr-4">
                      {d.entityName}
                      {d.reason && <span className="block text-xs text-foreground/50">{d.reason}</span>}
                    </td>
                    <td className="py-2 pr-4">{d.category ? EXPENSE_CATEGORY_LABELS[d.category] : "—"}</td>
                    <td className="py-2 pr-4">{CIRCUIT_LABELS[d.circuit]}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(d.neto, d.currency)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(d.iva, d.currency)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(d.percepciones, d.currency)}</td>
                    <td className="py-2 pr-4 text-right font-medium tabular-nums">{formatMoney(d.total, d.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
