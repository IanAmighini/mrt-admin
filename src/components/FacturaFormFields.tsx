import type { getInvoiceableRemitos } from "@/lib/ledger";
import { DEFAULT_IVA_RATE, formatMoney } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

export function FacturaFormFields({
  accountId,
  isWithholdingAgent,
  invoiceableRemitos,
}: {
  accountId: string;
  isWithholdingAgent: boolean;
  invoiceableRemitos: Awaited<ReturnType<typeof getInvoiceableRemitos>>;
}) {
  return (
    <>
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="number">
            Número
          </label>
          <input id="number" name="number" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="dueDate">
            Vencimiento (opcional)
          </label>
          <input id="dueDate" type="date" name="dueDate" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="currency">
            Moneda
          </label>
          <select id="currency" name="currency" defaultValue="ARS" className={inputClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="exchangeRate">
            Cotización (si es USD)
          </label>
          <input id="exchangeRate" name="exchangeRate" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="netAmount">
            Neto
          </label>
          <input id="netAmount" name="netAmount" required inputMode="decimal" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="ivaRate">
            Alícuota IVA %
          </label>
          <input id="ivaRate" name="ivaRate" defaultValue={DEFAULT_IVA_RATE} className={inputClass} />
        </div>
        {isWithholdingAgent && (
          <>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="retentionAmount">
                Retención
              </label>
              <input id="retentionAmount" name="retentionAmount" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="perceptionAmount">
                Percepción
              </label>
              <input id="perceptionAmount" name="perceptionAmount" className={inputClass} />
            </div>
          </>
        )}
      </div>
      {invoiceableRemitos.length > 0 && (
        <div>
          <p className="mb-1 text-sm">
            Remitos a incluir (opcional) — precargado con el pendiente, se puede bajar para
            facturar solo una parte
          </p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {invoiceableRemitos.map((remito) => (
              <div key={remito.id} className="flex items-center gap-2 text-sm">
                <input type="hidden" name="remitoId" value={remito.id} />
                <span className="flex-1">
                  Remito #{remito.number} — pendiente {formatMoney(remito.pending, remito.currency)}
                </span>
                <input
                  name="remitoAmount"
                  placeholder="0.00"
                  inputMode="decimal"
                  defaultValue={remito.pending.toFixed(2)}
                  className="w-24 rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <button type="submit" className={submitClass}>
        Crear factura
      </button>
    </>
  );
}
