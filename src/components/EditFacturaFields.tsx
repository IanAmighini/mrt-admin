import { DEFAULT_IVA_RATE } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

export function EditFacturaFields({
  documentId,
  defaultValues,
}: {
  documentId: string;
  defaultValues: {
    number: string;
    date: string;
    dueDate?: string;
    currency: string;
    exchangeRate?: string;
    netAmount: string;
    ivaRate?: string;
    retentionAmount?: string;
    perceptionAmount?: string;
  };
}) {
  return (
    <>
      <input type="hidden" name="documentId" value={documentId} />
      <p className="text-xs text-foreground/50">
        No se pueden cambiar acá los remitos vinculados a esta factura — para eso hay que
        borrarla y volver a facturar.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="number">
            Número
          </label>
          <input id="number" name="number" required defaultValue={defaultValues.number} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required defaultValue={defaultValues.date} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="dueDate">
            Vencimiento (opcional)
          </label>
          <input id="dueDate" type="date" name="dueDate" defaultValue={defaultValues.dueDate} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="currency">
            Moneda
          </label>
          <select id="currency" name="currency" defaultValue={defaultValues.currency} className={inputClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="exchangeRate">
            Cotización (si es USD)
          </label>
          <input id="exchangeRate" name="exchangeRate" defaultValue={defaultValues.exchangeRate} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="netAmount">
            Neto
          </label>
          <input
            id="netAmount"
            name="netAmount"
            required
            inputMode="decimal"
            defaultValue={defaultValues.netAmount}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="ivaRate">
            Alícuota IVA %
          </label>
          <input
            id="ivaRate"
            name="ivaRate"
            defaultValue={defaultValues.ivaRate ?? String(DEFAULT_IVA_RATE)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="retentionAmount">
            Retención
          </label>
          <input id="retentionAmount" name="retentionAmount" defaultValue={defaultValues.retentionAmount} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="perceptionAmount">
            Percepción
          </label>
          <input id="perceptionAmount" name="perceptionAmount" defaultValue={defaultValues.perceptionAmount} className={inputClass} />
        </div>
      </div>

      <button type="submit" className={submitClass}>
        Guardar cambios
      </button>
    </>
  );
}
