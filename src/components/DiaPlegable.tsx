import { ChevronRight } from "lucide-react";

/**
 * Un día de una lista (entregas, compras, cobros, pagos), plegado: una fila con la fecha, cuántos
 * movimientos hubo, de quiénes y el subtotal. La flecha lo abre y aparece el detalle. Plegados
 * entran muchos más días en la pantalla y se sigue mejor qué pasó cada día.
 */
export function DiaPlegable({
  titulo,
  cantidad,
  nombres,
  subtotal,
  pendientes,
  children,
}: {
  titulo: string;
  /** "3 entregas", "1 cobro". */
  cantidad: string;
  /** De quiénes fue, para reconocer el día sin abrirlo. */
  nombres: string[];
  subtotal: string;
  /** Cuántos quedan por cobrar o pagar ese día ("2 sin cobrar"), para verlo sin abrir. */
  pendientes?: string | null;
  children: React.ReactNode;
}) {
  const distintos = Array.from(new Set(nombres));
  const resumen = distintos.slice(0, 3).join(", ") + (distintos.length > 3 ? ` y ${distintos.length - 3} más` : "");
  return (
    <details className="group rounded-xl border border-foreground/10 bg-background shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-foreground/[0.02] [&::-webkit-details-marker]:hidden">
        <ChevronRight size={16} className="shrink-0 text-foreground/40 transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {titulo} <span className="font-normal text-foreground/50">· {cantidad}</span>
          </p>
          <p className="truncate text-xs text-foreground/50">{resumen}</p>
        </div>
        {pendientes && (
          <span className="hidden shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 sm:inline">
            {pendientes}
          </span>
        )}
        <span className="shrink-0 text-sm font-semibold tabular-nums">{subtotal}</span>
      </summary>
      <div className="divide-y divide-foreground/10 border-t border-foreground/10">{children}</div>
    </details>
  );
}
