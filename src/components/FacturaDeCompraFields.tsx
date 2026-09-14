"use client";

import { useState } from "react";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-sm";

/**
 * El número y la fecha de la factura del proveedor, cuando la compra ya viene con ella — que es lo
 * normal. Sin esto habría que cargar la compra y después la factura por separado, escribiendo dos
 * veces los mismos importes.
 *
 * Cuando una factura engloba varios remitos, o un remito se parte en dos facturas, se deja sin
 * tildar y la factura se carga aparte desde la ficha del proveedor, que es donde se ven todas las
 * compras pendientes juntas.
 */
export function FacturaDeCompraFields({
  defaultNumber,
  defaultDate,
}: {
  defaultNumber?: string;
  defaultDate?: string;
}) {
  const [tiene, setTiene] = useState(Boolean(defaultNumber));

  return (
    <div className="space-y-2 rounded-lg border border-foreground/10 p-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={tiene}
          onChange={(e) => setTiene(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Esta compra ya viene con su factura
          <span className="block text-xs text-foreground/50">
            Se carga sola con estos mismos importes y entra al libro de IVA. Si una factura cubre
            varios remitos, dejalo sin tildar y cargala desde la ficha del proveedor.
          </span>
        </span>
      </label>

      {tiene && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-foreground/70" htmlFor="facturaNumber">
              Nº de factura
            </label>
            <input
              id="facturaNumber"
              name="facturaNumber"
              required
              defaultValue={defaultNumber}
              placeholder="A-0001-00001234"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/70" htmlFor="facturaDate">
              Fecha de la factura
            </label>
            <input
              id="facturaDate"
              type="date"
              name="facturaDate"
              defaultValue={defaultDate}
              className={inputClass}
            />
          </div>
        </div>
      )}
    </div>
  );
}
