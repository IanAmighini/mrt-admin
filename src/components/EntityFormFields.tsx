const inputClass = "w-full rounded border border-black/20 px-3 py-2 text-sm";
const selectClass = inputClass;
const submitClass =
  "w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover";

export function EntityFormFields({ defaultType }: { defaultType: "CLIENTE" | "PROVEEDOR" }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1 col-span-2">
          <label className="text-sm" htmlFor="name">
            Nombre
          </label>
          <input id="name" name="name" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="type">
            Tipo
          </label>
          <select id="type" name="type" required defaultValue={defaultType} className={selectClass}>
            <option value="CLIENTE">Cliente</option>
            <option value="PROVEEDOR">Proveedor</option>
            <option value="AMBOS">Cliente y proveedor</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="taxId">
            CUIT / datos fiscales
          </label>
          <input id="taxId" name="taxId" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="contact">
            Contacto
          </label>
          <input id="contact" name="contact" className={inputClass} />
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
