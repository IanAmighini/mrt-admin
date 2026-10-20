"use client";

import { useState } from "react";
import type { FormaDeSueldo } from "@prisma/client";
import { hoyEnInput } from "@/lib/period";
import { buttonClass } from "./ui/Button";
import { controlClass } from "./ui/Field";
import { segmentoClass, segmentosClass } from "./ui/Segmentos";

/**
 * El alta de un empleado. Puede ser alguien nuevo o un proveedor que ya tenía ficha —Adriana, que
 * se cargaba como proveedor con su sueldo como gasto—: así conserva su cuenta y lo que ya tenía.
 */
export function EmpleadoFormFields({ proveedores }: { proveedores: { id: string; name: string }[] }) {
  const [forma, setForma] = useState<FormaDeSueldo>("SEMANAL");
  const [existenteId, setExistenteId] = useState("");

  return (
    <>
      <div className="space-y-1">
        <p className="text-sm">Cobra</p>
        <div className={segmentosClass}>
          {(["SEMANAL", "MENSUAL"] as const).map((f) => (
            <label key={f} className={segmentoClass}>
              <input type="radio" name="forma" value={f} checked={forma === f} onChange={() => setForma(f)} className="sr-only" />
              {f === "SEMANAL" ? "Por semana (horas)" : "Por mes"}
            </label>
          ))}
        </div>
      </div>

      {proveedores.length > 0 && (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="existenteId">
            ¿Ya tiene ficha como proveedor?
          </label>
          <select
            id="existenteId"
            name="existenteId"
            value={existenteId}
            onChange={(e) => setExistenteId(e.target.value)}
            className={controlClass()}
          >
            <option value="">No, es nuevo</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!existenteId && (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="empleado-nombre">
            Nombre
          </label>
          <input id="empleado-nombre" name="name" required className={controlClass()} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="empleado-monto">
            {forma === "SEMANAL" ? "Jornal (8 horas)" : "Sueldo del mes"}
          </label>
          <input
            id="empleado-monto"
            name="monto"
            required
            inputMode="decimal"
            placeholder={forma === "SEMANAL" ? "58.000" : "1.900.000"}
            className={controlClass()}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="empleado-desde">
            Desde
          </label>
          <input id="empleado-desde" type="date" name="desde" required defaultValue={hoyEnInput()} className={controlClass()} />
        </div>
      </div>

      <button type="submit" className={buttonClass("primario", "w-fit")}>
        Guardar
      </button>
    </>
  );
}
