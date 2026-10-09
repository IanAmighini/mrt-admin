"use client";

import { useState } from "react";
import type { Currency } from "@prisma/client";
import { formatMoney, parseNumeroSuave } from "@/lib/money";
import { hoyEnInput } from "@/lib/period";
import { CIRCUIT_LABELS } from "@/lib/labels";

export type EntidadCompradora = { id: string; name: string; type: string; moneda: Currency };

export type VentaInsumoDefaults = {
  documentId: string;
  entityId: string;
  circuit: "BLANCO" | "NEGRO";
  date: string;
  quantity: string;
  unitPrice: string;
  number: string;
  notes: string;
};

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

/**
 * La venta de un insumo, para cargarla y para corregirla. Cambia todo junto —cuánto salió del
 * stock, a qué precio y en qué cuenta— porque son la misma operación: corregir sólo el importe en la
 * cuenta corriente dejaba el stock diciendo otra cosa.
 *
 * El precio se escribe en pesos o en dólares. Se guarda en la moneda de la cuenta de quien compra:
 * si se escribió en la otra, hace falta la cotización.
 */
export function VentaInsumoFields({
  itemId,
  unidad,
  entidades,
  defaults,
}: {
  itemId: string;
  unidad: string;
  entidades: EntidadCompradora[];
  defaults?: VentaInsumoDefaults;
}) {
  const [entityId, setEntityId] = useState(defaults?.entityId ?? "");
  const entidad = entidades.find((e) => e.id === entityId);
  const monedaCuenta: Currency = entidad?.moneda ?? "ARS";
  const [moneda, setMoneda] = useState<Currency>(monedaCuenta);
  const [cantidad, setCantidad] = useState(defaults?.quantity ?? "");
  const [precio, setPrecio] = useState(defaults?.unitPrice ?? "");
  const [cotizacion, setCotizacion] = useState("");

  const num = (s: string) => parseNumeroSuave(s)?.toNumber() ?? 0;
  const otraMoneda = moneda !== monedaCuenta;
  const total = num(cantidad) * num(precio);
  const totalEnCuenta = !otraMoneda
    ? total
    : num(cotizacion) > 0
      ? monedaCuenta === "USD"
        ? total / num(cotizacion)
        : total * num(cotizacion)
      : null;

  return (
    <>
      <input type="hidden" name="itemId" value={itemId} />
      {defaults && <input type="hidden" name="documentId" value={defaults.documentId} />}
      <p className="text-xs text-foreground/50">
        Descuenta el stock y carga la plata en la cuenta de quien lo recibe. A un proveedor se le descuenta de lo
        que se le debe; a un cliente se le suma a lo que nos debe. Cuenta como venta en el resultado del mes.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="venta-fecha">
            Fecha
          </label>
          <input
            id="venta-fecha"
            type="date"
            name="date"
            required
            defaultValue={defaults?.date ?? hoyEnInput()}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="venta-entidad">
            A quién
          </label>
          <select
            id="venta-entidad"
            name="entityId"
            required
            value={entityId}
            onChange={(e) => {
              setEntityId(e.target.value);
              // El precio arranca en la moneda de la cuenta de quien compra.
              setMoneda(entidades.find((x) => x.id === e.target.value)?.moneda ?? "ARS");
            }}
            className={inputClass}
          >
            <option value="" disabled>
              — Elegir —
            </option>
            {entidades.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.moneda === "USD" ? " (cuenta en U$S)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="venta-cantidad">
            Cantidad ({unidad})
          </label>
          <input
            id="venta-cantidad"
            name="quantity"
            required
            inputMode="decimal"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="venta-precio">
            Precio unitario
          </label>
          <div className="flex gap-2">
            <input
              id="venta-precio"
              name="unitPrice"
              required
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              className={inputClass}
            />
            <select
              name="currency"
              value={moneda}
              onChange={(e) => setMoneda(e.target.value as Currency)}
              className={`${inputClass} w-auto`}
              aria-label="Moneda del precio"
            >
              <option value="ARS">$</option>
              <option value="USD">U$S</option>
            </select>
          </div>
        </div>
        {otraMoneda && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="venta-cotizacion">
              Cotización del dólar
            </label>
            <input
              id="venta-cotizacion"
              name="exchangeRate"
              required
              inputMode="decimal"
              value={cotizacion}
              onChange={(e) => setCotizacion(e.target.value)}
              placeholder="1.517"
              className={inputClass}
            />
            <p className="text-xs text-foreground/50">
              La cuenta de {entidad?.name ?? "quien compra"} se lleva en {monedaCuenta === "USD" ? "dólares" : "pesos"}.
            </p>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-sm" htmlFor="venta-circuito">
            Cuenta
          </label>
          <select id="venta-circuito" name="circuit" defaultValue={defaults?.circuit ?? "BLANCO"} className={inputClass}>
            <option value="BLANCO">{CIRCUIT_LABELS.BLANCO}</option>
            <option value="NEGRO">{CIRCUIT_LABELS.NEGRO}</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="venta-numero">
            Comprobante (opcional)
          </label>
          <input id="venta-numero" name="number" defaultValue={defaults?.number} placeholder="Se numera solo" className={inputClass} />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="venta-notas">
          Notas
        </label>
        <input id="venta-notas" name="notes" defaultValue={defaults?.notes} className={inputClass} />
      </div>
      {total > 0 && (
        <p className="text-sm tabular-nums">
          Total: <span className="font-semibold">{formatMoney(total, moneda)}</span>
          {otraMoneda && totalEnCuenta !== null && (
            <span className="text-foreground/60"> = {formatMoney(totalEnCuenta, monedaCuenta)} en su cuenta</span>
          )}
        </p>
      )}
      <button
        type="submit"
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        {defaults ? "Guardar cambios" : "Registrar venta"}
      </button>
    </>
  );
}
