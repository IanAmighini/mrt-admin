import Link from "next/link";
import { Clock, FileWarning, TrendingDown, Users } from "lucide-react";
import type { Circuit } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { getVencidosReport } from "@/lib/reports";

export async function VencidosSection({ circuit }: { circuit?: Circuit }) {
  const report = await getVencidosReport({ circuit });
  const totalArs = report.totalPendiente.get("ARS");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total vencido"
          value={formatMoney(totalArs ?? 0)}
          caption={`al ${report.asOf.toLocaleDateString("es-AR")}`}
          icon={TrendingDown}
          color="red"
        />
        <KpiCard
          label="Comprobantes"
          value={String(report.rows.length)}
          caption="vencidos e impagos"
          icon={FileWarning}
          color="amber"
        />
        <KpiCard
          label="Clientes afectados"
          value={String(report.clientesAfectados)}
          icon={Users}
          color="blue"
        />
        <KpiCard
          label="Atraso máximo"
          value={`${report.atrasoMaximo} días`}
          icon={Clock}
          color="amber"
        />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Por tramo de atraso</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Tramo (días)</th>
                <th className="py-2 pr-4">Comprobantes</th>
                <th className="py-2 pr-4">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {report.porBucket.map((b) => (
                <tr key={b.bucket} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">{b.bucket}</td>
                  <td className="py-2 pr-4">{b.count}</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(b.pendiente)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Detalle</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Cliente</th>
                <th className="py-2 pr-4">Comprobante</th>
                <th className="py-2 pr-4">Cuenta</th>
                <th className="py-2 pr-4">Vencimiento</th>
                <th className="py-2 pr-4">Atraso</th>
                <th className="py-2 pr-4">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.documentId} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/cuentas-corrientes/${row.entitySlug}`}
                      className="underline underline-offset-2"
                    >
                      {row.entityName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {DOCUMENT_TYPE_LABELS[row.type]} #{row.number}
                  </td>
                  <td className="py-2 pr-4">{CIRCUIT_LABELS[row.circuit]}</td>
                  <td className="py-2 pr-4 text-red-600 dark:text-red-400 whitespace-nowrap">
                    {row.dueDate.toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{row.diasAtraso} días</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(row.pendiente, row.currency)}</td>
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-foreground/40">
                    No hay comprobantes vencidos impagos. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {report.porCliente.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Resumen por cliente</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">Comprobantes</th>
                  <th className="py-2 pr-4">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {report.porCliente.map((c) => (
                  <tr key={c.entitySlug} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${c.entitySlug}`}
                        className="underline underline-offset-2"
                      >
                        {c.entityName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{c.count}</td>
                    <td className="py-2 pr-4 font-medium">{formatMoney(c.pendiente)}</td>
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
