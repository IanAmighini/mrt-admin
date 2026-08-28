const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

export function EditDocumentFields({
  documentId,
  defaultValues,
}: {
  documentId: string;
  defaultValues: {
    type: "NOTA_CREDITO" | "NOTA_DEBITO" | "AJUSTE";
    number: string;
    date: string;
    dueDate?: string;
    currency: string;
    exchangeRate?: string;
    amount: string;
    ajusteEffect: "SUMA" | "RESTA";
    reason?: string;
  };
}) {
  return (
    <>
      <input type="hidden" name="documentId" value={documentId} />

      <div className="space-y-1">
        <label className="text-sm" htmlFor="type">
          Tipo
        </label>
        <select id="type" name="type" required defaultValue={defaultValues.type} className={inputClass}>
          <option value="NOTA_CREDITO">Nota de crédito</option>
          <option value="NOTA_DEBITO">Nota de débito</option>
          <option value="AJUSTE">Ajuste manual</option>
        </select>
      </div>

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
          <label className="text-sm" htmlFor="amount">
            Monto *
          </label>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            defaultValue={defaultValues.amount}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="ajusteEffect">
            Efecto (solo Ajuste)
          </label>
          <select
            id="ajusteEffect"
            name="ajusteEffect"
            defaultValue={defaultValues.ajusteEffect}
            className={inputClass}
          >
            <option value="SUMA">Suma al saldo</option>
            <option value="RESTA">Resta al saldo</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="reason">
          Motivo (obligatorio para Ajuste)
        </label>
        <input id="reason" name="reason" defaultValue={defaultValues.reason} className={inputClass} />
      </div>

      <button type="submit" className={submitClass}>
        Guardar cambios
      </button>
    </>
  );
}
