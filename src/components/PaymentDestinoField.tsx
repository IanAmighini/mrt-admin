"use client";

import { useState } from "react";
import type { Entity } from "@prisma/client";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

export const PROVEEDOR_DIRECTO_VALUE = "PROVEEDOR_DIRECTO";

/** Selector de Destino/Origen de un cobro o pago. Si se elige "Proveedor" (solo disponible para
 * cobros, con la opción "directo a un proveedor"), despliega el selector de a qué proveedor fue. */
export function PaymentDestinoField({
  isCobro,
  treasuries,
  proveedores,
  defaultDestino,
  defaultProveedorId,
}: {
  isCobro: boolean;
  treasuries: Entity[];
  /** Solo si esta cuenta es de un cliente: lista de proveedores, para la opción "Proveedor". */
  proveedores?: Entity[];
  defaultDestino: string;
  defaultProveedorId?: string;
}) {
  const [destino, setDestino] = useState(defaultDestino);
  const showProveedores = isCobro && destino === PROVEEDOR_DIRECTO_VALUE && proveedores && proveedores.length > 0;

  return (
    <>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="destino">
          {isCobro ? "Destino" : "Origen"}
        </label>
        <select
          id="destino"
          name="destino"
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          className={inputClass}
        >
          <option value="">Sin asignar</option>
          {treasuries.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          {isCobro && proveedores && proveedores.length > 0 && (
            <option value={PROVEEDOR_DIRECTO_VALUE}>Proveedor</option>
          )}
        </select>
      </div>

      {showProveedores && (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="proveedorId">
            Proveedor
          </label>
          <select
            id="proveedorId"
            name="proveedorId"
            defaultValue={defaultProveedorId ?? ""}
            className={inputClass}
          >
            <option value="" disabled>
              Seleccionar proveedor...
            </option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
