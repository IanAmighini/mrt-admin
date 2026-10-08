import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Las tarjetas del Inicio y de los dashboards: un título, un resumen de una línea y unos pocos
 * renglones, con un "Ver" a la pantalla donde se resuelve. Se leen igual en la compu y en el
 * celular, que es lo que no pasaba con las tablas sueltas de los dashboards.
 */
export function Tarjeta({
  titulo,
  resumen,
  href,
  alerta = false,
  children,
}: {
  titulo: string;
  resumen?: string;
  href: string;
  /** Hay algo para hacer: el resumen se resalta. */
  alerta?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{titulo}</h2>
          {resumen && (
            <p className={`text-sm ${alerta ? "font-medium text-amber-700 dark:text-amber-400" : "text-foreground/60"}`}>
              {resumen}
            </p>
          )}
        </div>
        <Link
          href={href}
          className="flex shrink-0 items-center gap-1 text-xs text-foreground/50 hover:text-foreground"
        >
          Ver <ArrowRight size={12} />
        </Link>
      </div>
      <div className="divide-y divide-foreground/5">{children}</div>
    </section>
  );
}

export function Renglon({
  izquierda,
  debajo,
  derecha,
  href,
}: {
  izquierda: string;
  debajo?: string;
  derecha: string;
  /** Si el renglón lleva a otra pantalla que la de su tarjeta: los cheques adentro de Plata. */
  href?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <div className="min-w-0">
        <p className="truncate">
          {href ? (
            <Link href={href} className="underline-offset-2 hover:underline">
              {izquierda}
            </Link>
          ) : (
            izquierda
          )}
        </p>
        {debajo && <p className="truncate text-xs text-foreground/50">{debajo}</p>}
      </div>
      <p className="shrink-0 text-right tabular-nums">{derecha}</p>
    </div>
  );
}
