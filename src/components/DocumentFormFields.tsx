const inputClass = "w-full rounded border border-foreground/20 px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

export function DocumentFormFields({ fixedEntityId }: { fixedEntityId: string }) {
  return (
    <>
      <input type="hidden" name="entityId" value={fixedEntityId} />

      <div className="space-y-1">
        <p className="text-sm">Cuenta</p>
        <div className="grid grid-cols-2 gap-2">
          <label className={toggleClass}>
            <input type="radio" name="circuit" value="BLANCO" defaultChecked className="sr-only" />
            Blanco (con factura)
          </label>
          <label className={toggleClass}>
            <input type="radio" name="circuit" value="NEGRO" className="sr-only" />
            Negro (sin factura)
          </label>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="type">
          Tipo
        </label>
        <select id="type" name="type" required defaultValue="NOTA_CREDITO" className={inputClass}>
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
          <label className="text-sm" htmlFor="amount">
            Monto *
          </label>
          <input id="amount" name="amount" required inputMode="decimal" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="ajusteEffect">
            Efecto (solo Ajuste)
          </label>
          <select id="ajusteEffect" name="ajusteEffect" defaultValue="SUMA" className={inputClass}>
            <option value="SUMA">Suma al saldo</option>
            <option value="RESTA">Resta al saldo</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="reason">
          Motivo (obligatorio para Ajuste)
        </label>
        <input id="reason" name="reason" className={inputClass} />
      </div>

      <button type="submit" className={submitClass}>
        Crear
      </button>
    </>
  );
}
