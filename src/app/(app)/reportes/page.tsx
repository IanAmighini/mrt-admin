import Link from "next/link";
import { AlarmClock, CalendarCheck, Coins, Download, Factory, Milk, Package, Receipt, Send, ShoppingCart, TrendingUp, TriangleAlert, Wallet, type LucideIcon } from "lucide-react";
import type { Circuit } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { FormModal } from "@/components/Modal";
import { WeeklyReportFields } from "@/components/WeeklyReportFields";
import { SendWeeklyReportButton } from "@/components/SendWeeklyReportButton";
import { getLastRunInfo, getRecipients } from "@/lib/weekly-report";
import { sendMonthlyReportNow, sendWeeklyReportNow, updateWeeklyReportRecipients } from "./actions";
import { CIRCUIT_BY_SLUG, CIRCUIT_LABELS } from "@/lib/labels";
import { formatFecha, formatPeriodLabel, hoyComoFecha, periodFromSearchParams, PERIOD_PRESETS, toDateInputValue } from "@/lib/period";
import { isReportKey, REPORT_LABELS, type ReportKey } from "@/lib/reports";
import { VencidosSection } from "./sections/VencidosSection";
import { InsumosSection } from "./sections/InsumosSection";
import { VentasSection } from "./sections/VentasSection";
import { CobranzasSection } from "./sections/CobranzasSection";
import { ComprasSection } from "./sections/ComprasSection";
import { GastosSection } from "./sections/GastosSection";
import { ResultadoSection } from "./sections/ResultadoSection";
import { CostoBotellaSection } from "./sections/CostoBotellaSection";
import { ProduccionSection } from "./sections/ProduccionSection";
import { StockSection } from "./sections/StockSection";
import { ValorizacionSection } from "./sections/ValorizacionSection";
import { CierreSection } from "./sections/CierreSection";

const inputClass =
  "rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

/** Un botón de un grupo de opciones —período, cuenta—: el elegido en amarillo. */
const segmentoClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm transition-colors ${
    active ? "bg-primary font-medium text-primary-foreground shadow-sm" : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
  }`;

/**
 * Los reportes agrupados por de qué hablan, con una línea que dice qué contesta cada uno. Antes
 * eran nueve botones iguales en fila y había que leerlos todos para encontrar el que se buscaba.
 */
const GRUPOS: { titulo: string; reportes: { key: ReportKey; icono: LucideIcon; descripcion: string }[] }[] = [
  {
    titulo: "Clientes",
    reportes: [
      { key: "remitos-vencidos", icono: AlarmClock, descripcion: "Lo que ya venció y no se cobró" },
      { key: "ventas", icono: Send, descripcion: "Lo entregado, por cliente y producto" },
      { key: "cobranzas", icono: Wallet, descripcion: "Lo cobrado y lo pagado" },
    ],
  },
  {
    titulo: "Compras",
    reportes: [
      { key: "compras", icono: ShoppingCart, descripcion: "Insumos comprados, con su IVA" },
      { key: "gastos", icono: Receipt, descripcion: "Gastos por rubro y proveedor" },
    ],
  },
  {
    titulo: "Resultado",
    reportes: [
      { key: "resultado", icono: TrendingUp, descripcion: "Ventas menos insumos y gastos" },
      { key: "cierre-mes", icono: CalendarCheck, descripcion: "Si se ganó y cómo quedó el stock" },
      { key: "costo-botella", icono: Milk, descripcion: "Lo que cuesta y deja cada presentación" },
    ],
  },
  {
    titulo: "Producción y stock",
    reportes: [
      { key: "produccion", icono: Factory, descripcion: "Lo envasado y lo que consumió" },
      { key: "stock", icono: Package, descripcion: "Recuentos y diferencias" },
      { key: "insumos-bajo-minimo", icono: TriangleAlert, descripcion: "Lo que hay que reponer" },
      { key: "valorizacion-insumos", icono: Coins, descripcion: "Cuánto vale lo que hay en el depósito" },
    ],
  },
];

/** Los reportes-foto ("a hoy") no llevan rango: para esos tabs el filtro de período no aplica. */
const USA_PERIODO: Record<ReportKey, boolean> = {
  "remitos-vencidos": false,
  "insumos-bajo-minimo": false,
  "valorizacion-insumos": false,
  ventas: true,
  cobranzas: true,
  compras: true,
  gastos: true,
  resultado: true,
  "cierre-mes": true,
  "costo-botella": true,
  produccion: true,
  stock: true,
};

/** Los tabs que se pueden acotar por circuito. */
const USA_CIRCUITO: Record<ReportKey, boolean> = {
  "remitos-vencidos": true,
  "insumos-bajo-minimo": false,
  "valorizacion-insumos": false,
  ventas: true,
  cobranzas: false,
  compras: false,
  gastos: false,
  resultado: false,
  "cierre-mes": false,
  "costo-botella": false,
  produccion: false,
  stock: false,
};

const CIRCUIT_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todas las cuentas" },
  { value: "blanco", label: CIRCUIT_LABELS.BLANCO },
  { value: "negro", label: CIRCUIT_LABELS.NEGRO },
];

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; preset?: string; from?: string; to?: string; circuit?: string; al?: string }>;
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

  // La valorización es una foto a un día: hoy, o el que se elija (el cierre de un mes).
  const hoy = hoyComoFecha();
  const alElegido = sp.al && /^\d{4}-\d{2}-\d{2}$/.test(sp.al) ? new Date(`${sp.al}T00:00:00Z`) : null;
  const al = alElegido && !Number.isNaN(alElegido.getTime()) && alElegido < hoy ? alElegido : hoy;
  const usaFecha = report === "valorizacion-insumos";

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
  if (usaFecha && al < hoy) exportParams.set("al", toDateInputValue(al));

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

  const actual = GRUPOS.flatMap((g) => g.reportes).find((r) => r.key === report)!;
  const IconoActual = actual.icono;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Qué reporte. En la compu, una columna fija; en el celular, una fila que se desliza. */}
      <nav className="min-w-0 lg:sticky lg:top-4">
        <h1 className="mb-3 text-xl font-semibold">Reportes</h1>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:gap-5 lg:overflow-visible lg:px-0">
          {GRUPOS.map((g) => (
            <div key={g.titulo} className="flex shrink-0 gap-2 lg:flex-col lg:gap-1">
              <p className="hidden px-2 text-xs font-medium uppercase tracking-wide text-foreground/40 lg:block">{g.titulo}</p>
              {g.reportes.map(({ key, icono: Icono, descripcion }) => {
                const activo = report === key;
                return (
                  <Link
                    key={key}
                    href={{ pathname: "/reportes", query: { report: key } }}
                    className={`flex shrink-0 items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                      activo ? "bg-primary text-primary-foreground" : "border border-foreground/10 hover:bg-foreground/5 lg:border-transparent"
                    }`}
                  >
                    <Icono size={16} className={`mt-0.5 shrink-0 ${activo ? "" : "text-foreground/50"}`} />
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap text-sm font-medium">{REPORT_LABELS[key]}</span>
                      <span className={`hidden text-xs lg:block ${activo ? "text-primary-foreground/70" : "text-foreground/50"}`}>{descripcion}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20">
              <IconoActual size={19} />
            </span>
            <div>
              <h2 className="text-lg font-semibold">{REPORT_LABELS[report]}</h2>
              <p className="text-sm text-foreground/60">
                {actual.descripcion} ·{" "}
                {usaPeriodo ? formatPeriodLabel(period) : usaFecha && al < hoy ? `al ${formatFecha(al)}` : "a hoy"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <>
                {report === "cierre-mes" ? (
                  <SendWeeklyReportButton
                    action={sendMonthlyReportNow}
                    label="Enviar este cierre por mail"
                    campos={Object.fromEntries(exportParams)}
                  />
                ) : (
                  <SendWeeklyReportButton action={sendWeeklyReportNow} />
                )}
                <FormModal
                  triggerLabel="Destinatarios"
                  iconName="edit"
                  peso="secundario"
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

        {usaFecha && (
          <form className="flex flex-wrap items-end gap-2 rounded-xl border border-foreground/10 bg-background px-4 py-3 shadow-sm">
            <input type="hidden" name="report" value={report} />
            <div className="space-y-1">
              <label className="text-xs text-foreground/50" htmlFor="al">
                Al
              </label>
              <input
                id="al"
                type="date"
                name="al"
                defaultValue={toDateInputValue(al)}
                max={toDateInputValue(hoy)}
                className={`block ${inputClass}`}
              />
            </div>
            <button type="submit" className={`${inputClass} hover:bg-foreground/5`}>
              Ver
            </button>
            {al < hoy && (
              <Link href={{ pathname: "/reportes", query: { report } }} className={`${inputClass} hover:bg-foreground/5`}>
                Hoy
              </Link>
            )}
          </form>
        )}

        {(usaPeriodo || usaCircuito) && (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-foreground/10 bg-background px-4 py-3 shadow-sm">
            {usaPeriodo && (
              <>
                <div className="space-y-1">
                  <p className="text-xs text-foreground/50">Período</p>
                  <div className="flex flex-wrap gap-1 rounded-lg border border-foreground/10 p-1">
                    {PERIOD_PRESETS.map((p) => (
                      <Link
                        key={p.key}
                        href={{
                          pathname: "/reportes",
                          query: queryWith({ preset: p.key, from: undefined, to: undefined }),
                        }}
                        className={segmentoClass(preset === p.key && !sp.from && !sp.to)}
                      >
                        {p.label}
                      </Link>
                    ))}
                  </div>
                </div>
                <form className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="report" value={report} />
                  {usaCircuito && circuitSlug && <input type="hidden" name="circuit" value={circuitSlug} />}
                  <div className="space-y-1">
                    <label className="text-xs text-foreground/50" htmlFor="from">
                      Desde
                    </label>
                    <input id="from" type="date" name="from" defaultValue={sp.from} className={`block ${inputClass}`} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-foreground/50" htmlFor="to">
                      Hasta
                    </label>
                    <input id="to" type="date" name="to" defaultValue={sp.to} className={`block ${inputClass}`} />
                  </div>
                  <button type="submit" className={`${inputClass} hover:bg-foreground/5`}>
                    Ver
                  </button>
                </form>
              </>
            )}

            {usaCircuito && (
              <div className="space-y-1">
                <p className="text-xs text-foreground/50">Cuenta</p>
                <div className="flex flex-wrap gap-1 rounded-lg border border-foreground/10 p-1">
                  {CIRCUIT_FILTERS.map((f) => (
                    <Link
                      key={f.value}
                      href={{ pathname: "/reportes", query: queryWith({ circuit: f.value }) }}
                      className={segmentoClass(circuitSlug === f.value)}
                    >
                      {f.value ? f.label.split(" (")[0] : "Las dos"}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      {report === "remitos-vencidos" && <VencidosSection circuit={circuit} />}
      {report === "insumos-bajo-minimo" && <InsumosSection />}
      {report === "valorizacion-insumos" && <ValorizacionSection asOf={al} />}
      {report === "ventas" && <VentasSection period={period} circuit={circuit} />}
      {report === "cobranzas" && <CobranzasSection period={period} />}
      {report === "compras" && <ComprasSection period={period} />}
      {report === "gastos" && <GastosSection period={period} />}
      {report === "resultado" && <ResultadoSection period={period} />}
      {report === "cierre-mes" && <CierreSection period={period} />}
      {report === "costo-botella" && <CostoBotellaSection period={period} />}
      {report === "produccion" && <ProduccionSection period={period} />}
      {report === "stock" && <StockSection period={period} />}
      </div>
    </div>
  );
}
