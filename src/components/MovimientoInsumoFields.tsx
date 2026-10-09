import { KilosALitros } from "./KilosALitros";
import { hoyEnInput } from "@/lib/period";

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

export type MovimientoInsumoDefaults = {
  movementId: string;
  type: string;
  date: string;
  /** Sin signo: el signo lo dice "Efecto". */
  quantity: string;
  effect: "SUMA" | "RESTA";
  sourceKg: string;
  reason: string;
};

/**
 * Un movimiento de insumo cargado a mano —ingreso, ajuste, merma—, nuevo o para corregir. Los
 * `id` llevan un sufijo porque en la ficha hay uno abierto por cada fila del historial.
 *
 * "Efecto" sólo dice algo en un ajuste o una merma: un ingreso siempre suma. Con Ingreso elegido se
 * esconde sin JavaScript —la regla del contenedor mira la opción marcada de su propio desplegable—.
 */
export function MovimientoInsumoFields({
  itemId,
  unidad,
  esAceite,
  defaults,
}: {
  itemId: string;
  unidad: string;
  esAceite: boolean;
  defaults?: MovimientoInsumoDefaults;
}) {
  const sufijo = defaults?.movementId ?? "nuevo";
  return (
    <>
      <input type="hidden" name="itemId" value={itemId} />
      {defaults && <input type="hidden" name="movementId" value={defaults.movementId} />}
      <div className="grid grid-cols-2 gap-3 [&:has(select[name=type]_option[value=INGRESO]:checked)_.sin-ingreso]:hidden">
        <div className="space-y-1">
          <label className="text-sm" htmlFor={`type-${sufijo}`}>
            Tipo
          </label>
          <select id={`type-${sufijo}`} name="type" required defaultValue={defaults?.type ?? "INGRESO"} className={inputClass}>
            <option value="INGRESO">Ingreso</option>
            <option value="AJUSTE">Ajuste</option>
            <option value="MERMA">Merma</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor={`date-${sufijo}`}>
            Fecha
          </label>
          <input
            id={`date-${sufijo}`}
            type="date"
            name="date"
            required
            defaultValue={defaults?.date ?? hoyEnInput()}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor={`quantity-${sufijo}`}>
            Cantidad ({unidad})
          </label>
          <input
            id={`quantity-${sufijo}`}
            name="quantity"
            inputMode="decimal"
            defaultValue={defaults?.sourceKg ? "" : defaults?.quantity}
            className={inputClass}
          />
        </div>
        <div className="sin-ingreso space-y-1">
          <label className="text-sm" htmlFor={`effect-${sufijo}`}>
            Efecto
          </label>
          <select id={`effect-${sufijo}`} name="effect" defaultValue={defaults?.effect ?? "RESTA"} className={inputClass}>
            <option value="SUMA">Suma al stock</option>
            <option value="RESTA">Resta al stock</option>
          </select>
        </div>
      </div>
      {/* Sólo el aceite entra por kilos: es lo que dice el ticket de la balanza. */}
      {esAceite && <KilosALitros id={`sourceKg-${sufijo}`} className={inputClass} defaultValue={defaults?.sourceKg} />}
      <div className="space-y-1">
        <label className="text-sm" htmlFor={`reason-${sufijo}`}>
          Motivo
        </label>
        <input
          id={`reason-${sufijo}`}
          name="reason"
          required
          defaultValue={defaults?.reason}
          placeholder="Compra a proveedor X, conteo físico, rotura..."
          className={inputClass}
        />
      </div>
    </>
  );
}
