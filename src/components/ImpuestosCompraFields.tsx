"use client";

import { useEffect, useState } from "react";
import { PERCEPCIONES_COMPRA } from "@/lib/gasto";
import { DEFAULT_IVA_RATE } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-sm";

export type ImpuestosCompra = Record<string, string>;

export const impuestosIniciales = (defaults?: ImpuestosCompra): ImpuestosCompra => ({
  ivaRate: String(DEFAULT_IVA_RATE),
  ...defaults,
});

/**
 * Los tributos de una compra. Se aplican a las líneas que van a Blanco: en Negro no hay factura y
 * el precio de la línea es el importe.
 *
 * Mantiene su propio estado y avisa hacia afuera con `onChange`, para poder usarse tanto desde el
 * formulario grande —que necesita los valores para mostrar el total en vivo— como desde el modal de
 * edición, que lo renderiza desde el servidor y no le pasa nada.
 */
export function ImpuestosCompraFields({
  defaults,
  onChange,
}: {
  defaults?: ImpuestosCompra;
  onChange?: (valores: ImpuestosCompra) => void;
}) {
  const [valores, setValores] = useState<ImpuestosCompra>(() => impuestosIniciales(defaults));

  // El bloque se monta y desmonta según haya o no líneas en Blanco, y al volver arranca de cero.
  // Sin este aviso el formulario de arriba seguiría mostrando los tributos de la vuelta anterior,
  // que ya no están en ningún campo.
  useEffect(() => {
    onChange?.(valores);
    // Solo al montar: después ya avisa `set` en cada tecla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (name: string, value: string) =>
    setValores((previos) => {
      const siguiente = { ...previos, [name]: value };
      onChange?.(siguiente);
      return siguiente;
    });

  return (
    <div className="space-y-2 rounded-lg border border-foreground/10 p-3">
      <p className="text-sm font-medium">Impuestos de la parte en Blanco</p>
      <p className="text-xs text-foreground/50">
        El neto sale de las líneas y el IVA se suma encima. Las líneas en Negro no llevan impuestos.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-xs text-foreground/70" htmlFor="ivaRate">
            Alícuota IVA %
          </label>
          <input
            id="ivaRate"
            name="ivaRate"
            inputMode="decimal"
            value={valores.ivaRate ?? ""}
            onChange={(e) => set("ivaRate", e.target.value)}
            className={inputClass}
          />
        </div>
        {PERCEPCIONES_COMPRA.map((tributo) => (
          <div key={tributo.name} className="space-y-1">
            <label className="text-xs text-foreground/70" htmlFor={tributo.name}>
              {tributo.label}
            </label>
            <input
              id={tributo.name}
              name={tributo.name}
              inputMode="decimal"
              value={valores[tributo.name] ?? ""}
              onChange={(e) => set(tributo.name, e.target.value)}
              className={inputClass}
            />
          </div>
        ))}
        <div className="space-y-1">
          <label className="text-xs text-foreground/70" htmlFor="retentionAmount">
            Retención
          </label>
          <input
            id="retentionAmount"
            name="retentionAmount"
            inputMode="decimal"
            value={valores.retentionAmount ?? ""}
            onChange={(e) => set("retentionAmount", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}
