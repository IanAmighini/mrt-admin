import Link from "next/link";
import { formatFecha } from "@/lib/period";
import { Clock, FileWarning, TrendingDown, Users } from "lucide-react";
import type { Circuit } from "@prisma/client";
import { formatMoney, sumDecimals } from "@/lib/money";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { ETIQUETA } from "@/components/Etiquetas";
import { getVencidosReport } from "@/lib/reports";

/** Más atraso, más fuerte: del ámbar suave al rojo; el saldo inicial, gris, porque es otra cosa. */
const COLOR_DEL_TRAMO: Record<string, string> = {
  "1-15": "bg-amber-300 dark:bg-amber-500/70",
  "16-30": "bg-orange-400 dark:bg-orange-500/80",
  "31-60": "bg-red-400 dark:bg-red-500/80",
  "60+": "bg-red-600 dark:bg-red-600",
  "Saldo inicial": "bg-slate-400 dark:bg-slate-500",
};

export async function VencidosSection({ circuit }: { circuit?: Circuit }) {
  const report = await getVencidosReport({ circuit });
  const totalArs = report.totalPendiente.get("ARS");
  const totalTramos = sumDecimals(report.porBucket.map((b) => b.pendiente)).toNumber();

  // El detalle va por cliente —que es como se sale a cobrar—, con sus comprobantes adentro. Antes
  // eran dos tablas: el detalle suelto y, al final, el resumen por cliente.
  const porCliente = report.porCliente.map((c) => ({
    ...c,
    filas: report.rows.filter((r) => r.entitySlug === c.entitySlug),
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total vencido"
          value={formatMoney(totalArs ?? 0)}
          caption={`al ${formatFecha(report.asOf)}`}
          icon={TrendingDown}
          color="red"
        />
        <KpiCard label="Comprobantes" value={String(report.rows.length)} caption="vencidos e impagos" icon={FileWarning} color="amber" />
        <KpiCard label="Clientes" value={String(report.clientesAfectados)} caption="con algo vencido" icon={Users} color="blue" />
        <KpiCard
          label="Atraso máximo"
          value={`${report.atrasoMaximo} días`}
          caption="sin contar el saldo inicial"
          icon={Clock}
          color="amber"
        />
      </div>

      {totalTramos > 0 && (
        <section className="space-y-3 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
          <h3 className="text-sm font-semibold">Por antigüedad</h3>
          <div className="flex h-3 overflow-hidden rounded-full bg-foreground/[0.06]">
            {report.porBucket
              .filter((b) => b.pendiente.greaterThan(0))
              .map((b) => (
                <div
                  key={b.bucket}
                  className={COLOR_DEL_TRAMO[b.bucket]}
                  style={{ width: `${(b.pendiente.toNumber() / totalTramos) * 100}%` }}
                  title={`${b.bucket}: ${formatMoney(b.pendiente)}`}
                />
              ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {report.porBucket.map((b) => (
              <div key={b.bucket} className={`rounded-lg border border-foreground/10 px-3 py-2 ${b.count === 0 ? "opacity-50" : ""}`}>
                <p className="flex items-center gap-1.5 text-xs text-foreground/60">
                  <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COLOR_DEL_TRAMO[b.bucket]}`} />
                  {b.bucket === "Saldo inicial" ? "Anterior a la app" : `${b.bucket} días`}
                </p>
                <p className="font-semibold tabular-nums">{formatMoney(b.pendiente)}</p>
                <p className="text-xs text-foreground/50">
                  {b.count} {b.count === 1 ? "comprobante" : "comprobantes"}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Por cliente</h3>
        {porCliente.map((c) => (
          <div key={c.entitySlug} className="rounded-xl border border-foreground/10 bg-background shadow-sm">
            <div className="flex items-baseline justify-between gap-3 px-4 py-3">
              <Link href={`/cuentas-corrientes/${c.entitySlug}`} className="font-medium hover:underline hover:underline-offset-2">
                {c.entityName}
              </Link>
              <span className="shrink-0 text-right">
                <span className="font-semibold tabular-nums">{formatMoney(c.pendiente)}</span>
                <span className="ml-2 text-xs text-foreground/50">
                  {c.count} {c.count === 1 ? "comprobante" : "comprobantes"}
                </span>
              </span>
            </div>
            <div className="divide-y divide-foreground/10 border-t border-foreground/10">
              {c.filas.map((row) => (
                <div key={row.documentId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-sm">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span>{row.saldoInicial ? "Saldo inicial" : `${DOCUMENT_TYPE_LABELS[row.type]} #${row.number}`}</span>
                    <span className={ETIQUETA}>{CIRCUIT_LABELS[row.circuit].split(" (")[0]}</span>
                    <span
                      className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${
                        row.saldoInicial
                          ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          : row.diasAtraso > 30
                            ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}
                    >
                      {row.saldoInicial
                        ? "Deuda anterior a la app"
                        : `Venció el ${formatFecha(row.dueDate)} · ${row.diasAtraso} ${row.diasAtraso === 1 ? "día" : "días"}`}
                    </span>
                  </div>
                  <span className="tabular-nums">{formatMoney(row.pendiente, row.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {report.rows.length === 0 && (
          <p className="rounded-xl border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/40">
            No hay comprobantes vencidos impagos.
          </p>
        )}
      </section>
    </div>
  );
}
