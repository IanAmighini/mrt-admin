import { hoyEnInput } from "@/lib/period";

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

export type AjusteProductoDefaults = {
  movementId: string;
  kind: "PALLETS" | "CAJAS";
  type: "AJUSTE" | "MERMA";
  date: string;
  /** Sin signo: el signo lo dice "Efecto" (una merma siempre resta). */
  quantity: string;
  effect: "SUMA" | "RESTA";
  reason: string;
};

/** Un ajuste o una merma de producto terminado, nuevo o para corregir. */
export function AjusteProductoFields({ productId, defaults }: { productId: string; defaults?: AjusteProductoDefaults }) {
  return (
    <>
      <input type="hidden" name="productId" value={productId} />
      {defaults && (
        <>
          <input type="hidden" name="movementId" value={defaults.movementId} />
          <input type="hidden" name="kind" value={defaults.kind} />
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm">Tipo</label>
          <select name="type" defaultValue={defaults?.type ?? "AJUSTE"} className={inputClass}>
            <option value="AJUSTE">Ajuste</option>
            <option value="MERMA">Merma (rotura)</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm">Fecha</label>
          <input type="date" name="date" required defaultValue={defaults?.date ?? hoyEnInput()} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm">Cantidad</label>
          <div className="flex gap-2">
            <input name="quantity" required inputMode="numeric" defaultValue={defaults?.quantity} className={inputClass} />
            <select name="unidad" defaultValue={defaults?.kind ?? "PALLETS"} className={`${inputClass} w-auto`}>
              <option value="PALLETS">pallets</option>
              <option value="CAJAS">cajas sueltas</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm">Efecto (sólo el ajuste)</label>
          <select name="effect" defaultValue={defaults?.effect ?? "SUMA"} className={inputClass}>
            <option value="SUMA">Suma al stock</option>
            <option value="RESTA">Resta del stock</option>
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm">Motivo</label>
        <input
          name="reason"
          required
          defaultValue={defaults?.reason}
          placeholder="Conteo físico, stock inicial, pallet roto…"
          className={inputClass}
        />
      </div>
    </>
  );
}
