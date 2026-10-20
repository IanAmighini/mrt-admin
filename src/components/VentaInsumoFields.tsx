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
  /** Aceite: los kilos y el precio por tonelada con que se cargó. */
  kilos?: string;
  precioTonelada?: string;
  monedaPrecio?: Currency;
  cotizacion?: string;
  /** Cuenta 1: la alícuota de IVA. */
  ivaRate?: string;
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
  esAceite = false,
}: {
  itemId: string;
  unidad: string;
  entidades: EntidadCompradora[];
  defaults?: VentaInsumoDefaults;
  /** El aceite se vende como se compra: kilos del ticket y precio por tonelada. */
  esAceite?: boolean;
}) {
  const [entityId, setEntityId] = useState(defaults?.entityId ?? "");
  const entidad = entidades.find((e) => e.id === entityId);
  const monedaCuenta: Currency = entidad?.moneda ?? "ARS";
  // El aceite se pacta en dólares por tonelada: arranca ahí aunque la cuenta vaya en pesos.
  const [moneda, setMoneda] = useState<Currency>(defaults?.monedaPrecio ?? (esAceite ? "USD" : monedaCuenta));
  const [cantidad, setCantidad] = useState(defaults?.quantity ?? "");
  const [precio, setPrecio] = useState(defaults?.unitPrice ?? "");
  const [kilos, setKilos] = useState(defaults?.kilos ?? "");
  const [precioTonelada, setPrecioTonelada] = useState(defaults?.precioTonelada ?? "");
  const [cotizacion, setCotizacion] = useState(defaults?.cotizacion ?? "");
  const [circuit, setCircuit] = useState<"BLANCO" | "NEGRO">(defaults?.circuit ?? "BLANCO");
  const [ivaRate, setIvaRate] = useState(defaults?.ivaRate ?? "21");

  const num = (s: string) => parseNumeroSuave(s)?.toNumber() ?? 0;
  const otraMoneda = moneda !== monedaCuenta;
  // Con aceite, el importe sale de los kilos; los litros que salen del stock son kilos ÷ 0,92.
  const litros = esAceite ? num(kilos) / 0.92 : 0;
  const total = esAceite ? (num(kilos) / 1000) * num(precioTonelada) : num(cantidad) * num(precio);
  const totalEnCuenta = !otraMoneda
    ? total
    : num(cotizacion) > 0
      ? monedaCuenta === "USD"
        ? total / num(cotizacion)
        : total * num(cotizacion)
      : null;
  const iva = circuit === "BLANCO" && totalEnCuenta !== null ? totalEnCuenta * (num(ivaRate) / 100) : 0;
  // El precio por kilo en pesos, que es como lo dice el papel: US$ 1.540 la tonelada a 1.523 = $ 2.345,42.
  const porKiloEnPesos =
    esAceite && num(precioTonelada) > 0
      ? moneda === "ARS"
        ? num(precioTonelada) / 1000
        : num(cotizacion) > 0
          ? (num(precioTonelada) / 1000) * num(cotizacion)
          : null
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
              // El precio arranca en la moneda de la cuenta de quien compra; el aceite no, que se pacta
              // en dólares por tonelada sea quien sea.
              if (!esAceite) setMoneda(entidades.find((x) => x.id === e.target.value)?.moneda ?? "ARS");
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
        {esAceite ? (
          <>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="venta-kilos">
                Kilos
              </label>
              <input
                id="venta-kilos"
                name="kilos"
                required
                inputMode="decimal"
                placeholder="14.923"
                value={kilos}
                onChange={(e) => setKilos(e.target.value)}
                className={inputClass}
              />
              {litros > 0 && (
                <p className="text-xs tabular-nums text-foreground/50">
                  Salen {litros.toLocaleString("es-AR", { maximumFractionDigits: 3 })} L del stock (kilos ÷ 0,92)
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="venta-tonelada">
                Precio por tonelada
              </label>
              <div className="flex gap-2">
                <input
                  id="venta-tonelada"
                  name="precioTonelada"
                  required
                  inputMode="decimal"
                  placeholder="1.540"
                  value={precioTonelada}
                  onChange={(e) => setPrecioTonelada(e.target.value)}
                  className={inputClass}
                />
                <select
                  name="currency"
                  value={moneda}
                  onChange={(e) => setMoneda(e.target.value as Currency)}
                  className={`${inputClass} w-auto`}
                  aria-label="Moneda del precio"
                >
                  <option value="USD">U$S</option>
                  <option value="ARS">$</option>
                </select>
              </div>
              {porKiloEnPesos !== null && (
                <p className="text-xs tabular-nums text-foreground/50">= {formatMoney(porKiloEnPesos)} por kilo</p>
              )}
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
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
          <select
            id="venta-circuito"
            name="circuit"
            value={circuit}
            onChange={(e) => setCircuit(e.target.value as "BLANCO" | "NEGRO")}
            className={inputClass}
          >
            <option value="BLANCO">{CIRCUIT_LABELS.BLANCO}</option>
            <option value="NEGRO">{CIRCUIT_LABELS.NEGRO}</option>
          </select>
        </div>
        {/* En la Cuenta 1 se factura: el IVA va discriminado y entra así al libro de IVA. */}
        {circuit === "BLANCO" && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="venta-iva">
              IVA
            </label>
            <select id="venta-iva" name="ivaRate" value={ivaRate} onChange={(e) => setIvaRate(e.target.value)} className={inputClass}>
              <option value="21">21%</option>
              <option value="10.5">10,5%</option>
              <option value="27">27%</option>
            </select>
          </div>
        )}
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
        <div className="space-y-0.5 rounded-lg bg-foreground/[0.03] px-3 py-2 text-sm tabular-nums">
          <p>
            {circuit === "BLANCO" ? "Neto" : "Total"}: <span className="font-semibold">{formatMoney(total, moneda)}</span>
            {otraMoneda && totalEnCuenta !== null && (
              <span className="text-foreground/60"> = {formatMoney(totalEnCuenta, monedaCuenta)} en su cuenta</span>
            )}
          </p>
          {iva > 0 && totalEnCuenta !== null && (
            <>
              <p className="text-foreground/60">
                IVA {ivaRate.replace(".", ",")}%: {formatMoney(iva, monedaCuenta)}
              </p>
              <p>
                Total con IVA: <span className="font-semibold">{formatMoney(totalEnCuenta + iva, monedaCuenta)}</span>
              </p>
            </>
          )}
        </div>
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
