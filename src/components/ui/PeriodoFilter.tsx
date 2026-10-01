import Link from "next/link";
import { PERIOD_PRESETS } from "@/lib/period";
import { buttonClass } from "./Button";
import { controlClass } from "./Field";

/**
 * El selector de período: los cuatro atajos de siempre y un rango propio al lado.
 *
 * Los atajos son links y el rango es un formulario, y eso es a propósito: lo que se usa el 95% de
 * las veces —"este mes"— sale a un clic, y el rango a mano no obliga a pasar por él. Los dos
 * escriben en la URL, así que el período se puede compartir y sobrevive a recargar la página.
 *
 * Estaba copiado en Reportes y en el Libro de IVA, y faltaba en Caja chica, que era la única de
 * las tres sin manera de pedir un rango propio.
 */
export function PeriodoFilter({
  basePath,
  preset,
  from,
  to,
  /** Lo que hay que conservar al cambiar de período: el reporte elegido, el circuito. */
  conservar,
}: {
  basePath: string;
  preset: string | null;
  from?: string;
  to?: string;
  conservar?: Record<string, string | undefined>;
}) {
  const extras = Object.entries(conservar ?? {}).filter(([, v]) => v);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-1">
        {PERIOD_PRESETS.map((p) => (
          <Link
            key={p.key}
            href={{
              pathname: basePath,
              query: { ...Object.fromEntries(extras), preset: p.key },
            }}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              preset === p.key
                ? "bg-primary font-medium text-primary-foreground"
                : "border border-foreground/20 hover:bg-foreground/5"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-2">
        {extras.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="from">
            Desde
          </label>
          <input id="from" type="date" name="from" defaultValue={from} className={controlClass()} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-foreground/60" htmlFor="to">
            Hasta
          </label>
          <input id="to" type="date" name="to" defaultValue={to} className={controlClass()} />
        </div>
        <button type="submit" className={buttonClass("secundario")}>
          Filtrar
        </button>
      </form>
    </div>
  );
}
