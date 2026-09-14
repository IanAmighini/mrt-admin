import Link from "next/link";
import { Download } from "lucide-react";
import { requireRole } from "@/lib/auth-helpers";
import { formatPeriodLabel, periodFromSearchParams, PERIOD_PRESETS } from "@/lib/period";
import { LibroIvaSection } from "./LibroIvaSection";

const inputClass =
  "rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";

const chipClass = (active: boolean) =>
  `rounded px-3 py-1.5 text-sm ${
    active ? "bg-primary text-primary-foreground" : "border border-foreground/20 hover:bg-foreground/5"
  }`;

/**
 * Vive fuera de /reportes, que es gerencial, porque la secretaría necesita este libro para
 * cotejarlo con ARCA antes de pasarle el Excel al contador — pero no el resto de los reportes.
 */
export default async function LibroIvaPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const user = await requireRole(["ADMIN", "SOLO_LECTURA", "SECRETARIA"]);
  const sp = await searchParams;
  // El libro se declara por mes, así que ese es el período por defecto y no "esta semana".
  const { period, preset } = periodFromSearchParams({ preset: sp.preset ?? "mes", from: sp.from, to: sp.to });

  const params = new URLSearchParams();
  if (sp.from) params.set("from", sp.from);
  if (sp.to) params.set("to", sp.to);
  if (!sp.from && !sp.to && preset) params.set("preset", preset);
  const query = params.toString();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold mb-1">Libro de IVA</h1>
          <p className="text-sm text-foreground/60">{formatPeriodLabel(period)}</p>
        </div>
        <a
          href={`/libro-iva/export${query ? `?${query}` : ""}`}
          className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
        >
          <Download size={16} />
          Descargar Excel
        </a>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-foreground/10 pt-4">
        <div className="flex flex-wrap gap-1">
          {PERIOD_PRESETS.map((p) => (
            <Link
              key={p.key}
              href={{ pathname: "/libro-iva", query: { preset: p.key } }}
              className={chipClass(!sp.from && !sp.to && preset === p.key)}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <form className="flex flex-wrap items-end gap-2">
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
      </div>

      <LibroIvaSection period={period} canEdit={user.role === "ADMIN"} />
    </div>
  );
}
