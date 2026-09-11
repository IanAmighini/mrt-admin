"use client";

import { useState } from "react";
import type { Entity } from "@prisma/client";
import { PROVEEDOR_DIRECTO_VALUE } from "@/lib/payment-destino";
import { formatMoney, parseNumeroSuave } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

/** Selector de Destino/Origen de un cobro o pago. Si se elige "Proveedor" (solo disponible para
 * cobros, con la opción "directo a un proveedor"), despliega el selector de a qué proveedor fue. */
export function PaymentDestinoField({
  isCobro,
  treasuries,
  proveedores,
  defaultDestino,
  defaultProveedorId,
  montoDelCobro,
}: {
  isCobro: boolean;
  /** Lo que se está cobrando, para mostrar cuánto se le acredita al proveedor si su cuenta va en
   * otra moneda. Sólo se usa para la vista previa; el cálculo lo rehace el servidor. */
  montoDelCobro?: string;
  treasuries: Entity[];
  /** Solo si esta cuenta es de un cliente: lista de proveedores, para la opción "Proveedor". */
  proveedores?: Entity[];
  defaultDestino: string;
  defaultProveedorId?: string;
}) {
  const [destino, setDestino] = useState(defaultDestino);
  const [proveedorId, setProveedorId] = useState(defaultProveedorId ?? "");
  const [cotizacion, setCotizacion] = useState("");
  const showProveedores = isCobro && destino === PROVEEDOR_DIRECTO_VALUE && proveedores && proveedores.length > 0;

  // Si la cuenta del proveedor va en otra moneda que la del cobro, el monto no se puede copiar tal
  // cual: hay que convertirlo, y para eso hace falta la cotización.
  const proveedor = proveedores?.find((p) => p.id === proveedorId);
  const necesitaCotizacion = Boolean(showProveedores && proveedor && proveedor.moneda === "USD");
  const montoNum = parseNumeroSuave(montoDelCobro ?? "");
  const cotizacionNum = parseNumeroSuave(cotizacion);
  const seLeAcredita =
    necesitaCotizacion && montoNum && cotizacionNum?.greaterThan(0)
      ? montoNum.dividedBy(cotizacionNum)
      : null;

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
            value={proveedorId}
            onChange={(e) => setProveedorId(e.target.value)}
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

      {necesitaCotizacion && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="cotizacionProveedor">
              Cotización *
            </label>
            <input
              id="cotizacionProveedor"
              name="cotizacionProveedor"
              required
              inputMode="decimal"
              placeholder="1.512"
              value={cotizacion}
              onChange={(e) => setCotizacion(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm">Se le acredita</p>
            <p className="px-3 py-2 text-sm font-semibold tabular-nums">
              {seLeAcredita ? formatMoney(seLeAcredita, "USD") : "—"}
            </p>
          </div>
          <p className="col-span-2 text-xs text-foreground/50">
            La cuenta de {proveedor?.name} se lleva en dólares, así que lo cobrado en pesos se
            convierte antes de descontarle lo que se le debe.
          </p>
        </div>
      )}
    </>
  );
}
