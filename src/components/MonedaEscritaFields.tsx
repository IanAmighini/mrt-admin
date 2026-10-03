"use client";

import { useState } from "react";
import type { Currency } from "@prisma/client";

const NOMBRE: Record<Currency, string> = { ARS: "Pesos", USD: "Dólares" };

/**
 * En qué moneda se escribieron los montos, y la cotización si no es la de la cuenta.
 *
 * Todo se guarda en la moneda de la cuenta (ver `aLaMonedaDeLaCuenta`): este selector no elige en
 * qué se guarda, sino en qué se está escribiendo. Arranca en la de la cuenta, y la cotización sólo
 * aparece —y es obligatoria— cuando se elige la otra, que es el único caso en que hay que convertir.
 *
 * Se puede controlar desde afuera —los formularios que muestran el total en la moneda escrita— o
 * dejarlo solo con `defaultValue`.
 */
export function MonedaEscritaFields({
  monedaCuenta,
  value: valueControlado,
  onChange,
  defaultValue,
  defaultCotizacion,
  className,
}: {
  monedaCuenta: Currency;
  value?: Currency;
  onChange?: (moneda: Currency) => void;
  defaultValue?: Currency;
  defaultCotizacion?: string;
  className: string;
}) {
  const [propio, setPropio] = useState<Currency>(defaultValue ?? monedaCuenta);
  const value = valueControlado ?? propio;
  const convierte = value !== monedaCuenta;
  return (
    <>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="currency">
          Montos en
        </label>
        <select
          id="currency"
          name="currency"
          value={value}
          onChange={(e) => {
            const m = e.target.value as Currency;
            setPropio(m);
            onChange?.(m);
          }}
          className={className}
        >
          {(["ARS", "USD"] as const).map((m) => (
            <option key={m} value={m}>
              {NOMBRE[m]}
              {m === monedaCuenta ? " (la de la cuenta)" : ""}
            </option>
          ))}
        </select>
      </div>
      {convierte && (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="exchangeRate">
            Cotización del dólar
          </label>
          <input
            id="exchangeRate"
            name="exchangeRate"
            required
            inputMode="decimal"
            placeholder="1.523"
            defaultValue={defaultCotizacion}
            className={className}
          />
          <p className="text-xs text-foreground/50">
            La cuenta se lleva en {NOMBRE[monedaCuenta].toLowerCase()}: los montos se convierten con esta
            cotización al guardar.
          </p>
        </div>
      )}
    </>
  );
}
