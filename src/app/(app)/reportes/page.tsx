import Link from "next/link";
import { Download } from "lucide-react";
import type { Circuit } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { FormModal } from "@/components/Modal";
import { WeeklyReportFields } from "@/components/WeeklyReportFields";
import { SendWeeklyReportButton } from "@/components/SendWeeklyReportButton";
import { getLastRunInfo, getRecipients } from "@/lib/weekly-report";
import { sendWeeklyReportNow, updateWeeklyReportRecipients } from "./actions";
import { CIRCUIT_BY_SLUG, CIRCUIT_LABELS } from "@/lib/labels";
import { formatPeriodLabel, periodFromSearchParams, PERIOD_PRESETS } from "@/lib/period";
import { isReportKey, REPORT_KEYS, REPORT_LABELS, type ReportKey } from "@/lib/reports";
import { VencidosSection } from "./sections/VencidosSection";
import { InsumosSection } from "./sections/InsumosSection";
import { VentasSection } from "./sections/VentasSection";
import { CobranzasSection } from "./sections/CobranzasSection";
import { ComprasSection } from "./sections/ComprasSection";
import { ProduccionSection } from "./sections/ProduccionSection";

const inputClass =
  "rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

const chipClass = (active: boolean) =>
  `rounded px-3 py-1.5 text-sm ${
    active ? "bg-primary text-primary-foreground" : "border border-foreground/20 hover:bg-foreground/5"
  }`;

/** Los reportes-foto ("a hoy") no llevan rango: para esos tabs el filtro de período no aplica. */
const USA_PERIODO: Record<ReportKey, boolean> = {
  "remitos-vencidos": false,
  "insumos-bajo-minimo": false,
  ventas: true,
  cobranzas: true,
  compras: true,
  produccion: true,
};

/** Los tabs que se pueden acotar por circuito. */
const USA_CIRCUITO: Record<ReportKey, boolean> = {
  "remitos-vencidos": true,
  "insumos-bajo-minimo": false,
  ventas: true,
  cobranzas: false,
  compras: false,
  produccion: false,
};

const CIRCUIT_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todas las cuentas" },
  { value: "blanco", label: CIRCUIT_LABELS.BLANCO },
  { value: "negro", label: CIRCUIT_LABELS.NEGRO },
];

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; preset?: string; from?: string; to?: string; circuit?: string }>;
}) {
  const user = await requireRole(["ADMIN", "SOLO_LECTURA"]);
  const sp = await searchParams;
  const isAdmin = user.role === "ADMIN";

  const [recipients, lastRun] = isAdmin
    ? await Promise.all([getRecipients(), getLastRunInfo()])
    : [[], null];

  const report: ReportKey = isReportKey(sp.report) ? sp.report : "remitos-vencidos";
  const { period, preset } = periodFromSearchParams(sp);
  const circuitSlug = CIRCUIT_FILTERS.some((f) => f.value === sp.circuit) ? (sp.circuit ?? "") : "";
  const circuit: Circuit | undefined = circuitSlug ? CIRCUIT_BY_SLUG[circuitSlug] : undefined;

  const usaPeriodo = USA_PERIODO[report];
  const usaCircuito = USA_CIRCUITO[report];

  // El link de descarga se arma con los mismos parámetros que la vista: lo que ves es lo que bajás.
  const exportParams = new URLSearchParams({ report });
  if (usaPeriodo) {
    if (sp.from) exportParams.set("from", sp.from);
    if (sp.to) exportParams.set("to", sp.to);
    if (!sp.from && !sp.to && preset) exportParams.set("preset", preset);
  }
  if (usaCircuito && circuitSlug) exportParams.set("circuit", circuitSlug);

  /** Conserva los filtros vigentes al armar los links de los chips. */
  function queryWith(overrides: Record<string, string | undefined>) {
    const base: Record<string, string> = { report };
    if (usaPeriodo) {
      if (sp.from) base.from = sp.from;
      if (sp.to) base.to = sp.to;
      if (!sp.from && !sp.to && preset) base.preset = preset;
    }
    if (usaCircuito && circuitSlug) base.circuit = circuitSlug;

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === "") delete base[key];
      else base[key] = value;
    }
    return base;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold mb-1">Reportes</h1>
          <p className="text-sm text-foreground/60">
            {REPORT_LABELS[report]}
            {usaPeriodo ? ` — ${formatPeriodLabel(period)}` : " — a hoy"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <SendWeeklyReportButton action={sendWeeklyReportNow} />
              <FormModal
                triggerLabel="Reporte semanal"
                iconName="edit"
                title="Reporte semanal por mail"
                action={updateWeeklyReportRecipients}
              >
                <WeeklyReportFields recipients={recipients.join("\n")} lastRun={lastRun} />
              </FormModal>
            </>
          )}
          <a
            href={`/reportes/export?${exportParams.toString()}`}
            className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            <Download size={16} />
            Descargar Excel
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {REPORT_KEYS.map((key) => (
          <Link
            key={key}
            href={{ pathname: "/reportes", query: { report: key } }}
            className={chipClass(report === key)}
          >
            {REPORT_LABELS[key]}
          </Link>
        ))}
      </div>

      {(usaPeriodo || usaCircuito) && (
        <div className="flex flex-wrap items-end gap-3 border-t border-foreground/10 pt-4">
          {usaPeriodo && (
            <>
              <div className="flex flex-wrap gap-1">
                {PERIOD_PRESETS.map((p) => (
                  <Link
                    key={p.key}
                    href={{
                      pathname: "/reportes",
                      query: queryWith({ preset: p.key, from: undefined, to: undefined }),
                    }}
                    className={chipClass(preset === p.key)}
                  >
                    {p.label}
                  </Link>
                ))}
              </div>
              <form className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="report" value={report} />
                {usaCircuito && circuitSlug && <input type="hidden" name="circuit" value={circuitSlug} />}
                <div className="space-y-1">
                  <label className="text-xs text-foreground/60" htmlFor="from">
                    Desde
                  </label>
                  <input id="from" type="date" name="from" defaultValue={sp.from} className={`block ${inputClass}`} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-foreground/60" htmlFor="to">
                    Hasta
                  </label>
                  <input id="to" type="date" name="to" defaultValue={sp.to} className={`block ${inputClass}`} />
                </div>
                <button type="submit" className={`${inputClass} hover:bg-foreground/5`}>
                  Filtrar
                </button>
              </form>
            </>
          )}

          {usaCircuito && (
            <div className="flex flex-wrap gap-1">
              {CIRCUIT_FILTERS.map((f) => (
                <Link
                  key={f.value}
                  href={{ pathname: "/reportes", query: queryWith({ circuit: f.value }) }}
                  className={chipClass(circuitSlug === f.value)}
                >
                  {f.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {report === "remitos-vencidos" && <VencidosSection circuit={circuit} />}
      {report === "insumos-bajo-minimo" && <InsumosSection />}
      {report === "ventas" && <VentasSection period={period} circuit={circuit} />}
      {report === "cobranzas" && <CobranzasSection period={period} />}
      {report === "compras" && <ComprasSection period={period} />}
      {report === "produccion" && <ProduccionSection period={period} />}
    </div>
  );
}
