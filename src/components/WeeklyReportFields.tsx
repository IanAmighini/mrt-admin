import { formatDateTime } from "@/lib/period";
import type { LastRunInfo } from "@/lib/weekly-report";

export function WeeklyReportFields({
  recipients,
  lastRun,
}: {
  recipients: string;
  lastRun: LastRunInfo | null;
}) {
  return (
    <>
      <p className="text-xs text-foreground/50">
        Todos los lunes a las 8 de la mañana sale un mail con lo vencido, los insumos bajo mínimo,
        los pedidos pendientes y el resumen de la semana que terminó, con el detalle de vencidos
        adjunto en Excel. Una dirección por línea (o separadas por coma).
      </p>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="recipients">
          Destinatarios
        </label>
        <textarea
          id="recipients"
          name="recipients"
          rows={3}
          defaultValue={recipients}
          placeholder="alguien@ejemplo.com"
          className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
        />
      </div>
      <p className="text-xs text-foreground/50">
        Último envío:{" "}
        {lastRun ? `${formatDateTime(lastRun.at)} — ${lastRun.resultado}` : "todavía no se envió ninguno"}
      </p>
      <button
        type="submit"
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        Guardar
      </button>
    </>
  );
}
