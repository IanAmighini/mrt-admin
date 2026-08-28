type ItemInfo = { id: string; name: string; unit: string };

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass = "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

/**
 * Formulario acotado para "Ingreso de X" / "Registrar merma" desde las tarjetas de Stock,
 * donde ya se sabe el tipo (INGRESO/MERMA) y el efecto — solo falta elegir cuál insumo de la
 * categoría y la cantidad. Para movimientos más generales (Ajuste, Venta) se sigue usando el
 * formulario completo de la ficha del insumo (/stock/[itemId]).
 */
export function ItemMovementFields({
  items,
  type,
  showConversion,
}: {
  items: ItemInfo[];
  type: "INGRESO" | "MERMA";
  /** Aceite se suele ingresar por Kg + factor de conversión, no directo en litros. */
  showConversion?: boolean;
}) {
  return (
    <>
      <input type="hidden" name="type" value={type} />
      {type === "MERMA" && <input type="hidden" name="effect" value="RESTA" />}
      <div className="space-y-1">
        <label className="text-sm" htmlFor={`itemId-${type}`}>
          Insumo
        </label>
        <select id={`itemId-${type}`} name="itemId" required className={inputClass}>
          <option value="">— Elegir —</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor={`date-${type}`}>
            Fecha
          </label>
          <input id={`date-${type}`} type="date" name="date" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor={`quantity-${type}`}>
            Cantidad
          </label>
          <input id={`quantity-${type}`} name="quantity" inputMode="decimal" className={inputClass} />
        </div>
      </div>
      {showConversion && (
        <>
          <p className="text-xs text-foreground/50">
            Si cargás Kg + factor de conversión, la cantidad se calcula sola (Kg × factor) y pisa
            el campo de arriba.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor={`sourceKg-${type}`}>
                Kg (opcional)
              </label>
              <input id={`sourceKg-${type}`} name="sourceKg" inputMode="decimal" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor={`conversionFactor-${type}`}>
                Factor de conversión Kg→L
              </label>
              <input
                id={`conversionFactor-${type}`}
                name="conversionFactor"
                inputMode="decimal"
                className={inputClass}
              />
            </div>
          </div>
        </>
      )}
      <div className="space-y-1">
        <label className="text-sm" htmlFor={`reason-${type}`}>
          Motivo
        </label>
        <input
          id={`reason-${type}`}
          name="reason"
          required
          placeholder={type === "MERMA" ? "Rotura, derrame, conteo físico..." : "Compra a proveedor X..."}
          className={inputClass}
        />
      </div>
      <button type="submit" className={submitClass}>
        {type === "MERMA" ? "Registrar merma" : "Registrar ingreso"}
      </button>
    </>
  );
}
