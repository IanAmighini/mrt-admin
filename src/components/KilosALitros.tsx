"use client";

import { useState } from "react";
import { formatQuantity, parseNumeroSuave } from "@/lib/money";
import { DENSIDAD_TEXTO, litrosDeKilos } from "@/lib/aceite";

/**
 * El casillero de kilos del ticket de balanza, con los litros que dan al lado mientras se escribe.
 *
 * Mostrar el resultado en vivo es lo que hace que un error se vea antes de guardar: 28.100 kilos
 * tienen que dar unos 30.900 litros, y si da otra cosa se nota en el momento.
 */
export function KilosALitros({ id, className, defaultValue = "" }: { id: string; className: string; defaultValue?: string }) {
  const [kilos, setKilos] = useState(defaultValue);
  const n = parseNumeroSuave(kilos);
  const litros = n && n.greaterThan(0) ? litrosDeKilos(n) : null;

  return (
    <div className="space-y-1">
      <label className="text-sm" htmlFor={id}>
        Kilos del ticket de balanza
      </label>
      <input
        id={id}
        name="sourceKg"
        inputMode="decimal"
        placeholder="28.100"
        value={kilos}
        onChange={(e) => setKilos(e.target.value)}
        className={className}
      />
      <p className="text-xs text-foreground/50">
        {litros
          ? `= ${formatQuantity(litros, "L")} (kilos ÷ ${DENSIDAD_TEXTO}). Entra esto al stock; la cantidad de arriba se ignora.`
          : `Si cargás los kilos, los litros se calculan solos (kilos ÷ ${DENSIDAD_TEXTO}) y la cantidad de arriba se ignora.`}
      </p>
    </div>
  );
}
