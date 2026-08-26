const inputClass = "w-full rounded border border-black/20 px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover";

export function EntityFormFields({ defaultType }: { defaultType: "CLIENTE" | "PROVEEDOR" }) {
  return (
    <>
      <input type="hidden" name="type" value={defaultType} />
      <div className="space-y-1">
        <label className="text-sm" htmlFor="name">
          Nombre
        </label>
        <input id="name" name="name" required placeholder="Razón social o nombre" className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="email@ejemplo.com"
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="phone">
            Teléfono
          </label>
          <input id="phone" name="phone" placeholder="011 1234-5678" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="taxId">
            CUIT
          </label>
          <input id="taxId" name="taxId" placeholder="20-12345678-9" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="saldoInicialBlanco">
            Saldo inicial Blanco (opcional)
          </label>
          <input
            id="saldoInicialBlanco"
            name="saldoInicialBlanco"
            inputMode="decimal"
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="saldoInicialNegro">
            Saldo inicial Negro (opcional)
          </label>
          <input
            id="saldoInicialNegro"
            name="saldoInicialNegro"
            inputMode="decimal"
            className={inputClass}
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="address">
          Dirección
        </label>
        <input id="address" name="address" placeholder="Calle 123, Ciudad" className={inputClass} />
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="notes">
          Notas
        </label>
        <textarea id="notes" name="notes" placeholder="Observaciones..." rows={2} className={inputClass} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isWithholdingAgent" />
        Es agente de retención/percepción
      </label>
      <button type="submit" className={submitClass}>
        Crear
      </button>
    </>
  );
}
