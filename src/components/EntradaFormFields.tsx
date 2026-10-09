"use client";

import { useState } from "react";
import type { Circuit, Currency, PaymentConcepto, PaymentMethod } from "@prisma/client";
import { CIRCUIT_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { metodoValidoEn } from "@/lib/pagos";
import { formatMoney, parseNumeroSuave } from "@/lib/money";
import { hoyEnInput } from "@/lib/period";

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

export type EntradaDefaults = {
  paymentId: string;
  concepto: PaymentConcepto;
  circuit: Circuit;
  date: string;
  /** En pesos si la cuenta va en dólares, como se cargó. */
  amount: string;
  exchangeRate: string;
  method: PaymentMethod;
  destino: string;
  reference: string;
  numeroOperacion: string;
};

/**
 * Plata que entra desde la cuenta de un proveedor: un cobro (nos paga algo que le vendimos) o, en
 * la cuenta del socio, un aporte de capital. Es el pago al revés, así que pide lo mismo que un pago
 * —cuenta, monto, cómo y a qué caja— pero sin cheques, retenciones ni "directo a un proveedor".
 */
export function EntradaFormFields({
  entityId,
  moneda,
  esSocio,
  treasuries,
  defaults,
}: {
  entityId: string;
  moneda: Currency;
  /** La cuenta por la que se retira para los socios: ahí también se carga un aporte de capital. */
  esSocio: boolean;
  treasuries: { id: string; name: string }[];
  defaults?: EntradaDefaults;
}) {
  const [concepto, setConcepto] = useState<PaymentConcepto>(
    defaults?.concepto ?? (esSocio ? "APORTE_CAPITAL" : "COBRO_PROVEEDOR")
  );
  const [circuit, setCircuit] = useState<Circuit>(defaults?.circuit ?? "NEGRO");
  const [method, setMethod] = useState<PaymentMethod>(defaults?.method ?? "EFECTIVO");
  const [monto, setMonto] = useState(defaults?.amount ?? "");
  const [cotizacion, setCotizacion] = useState(defaults?.exchangeRate ?? "");
  const metodos = (["EFECTIVO", "TRANSFERENCIA"] as const).filter((m) => metodoValidoEn(circuit, m));
  // El banco no recibe plata en negro: ahí la caja es la única posible.
  const cajaPorDefecto =
    defaults?.destino ??
    (circuit === "NEGRO"
      ? treasuries.find((t) => t.name !== "Banco Galicia")
      : treasuries.find((t) => t.name === "Banco Galicia")
    )?.id ??
    treasuries[0]?.id ??
    "";

  const enDolares = moneda === "USD";
  const montoNum = parseNumeroSuave(monto);
  const cotizacionNum = parseNumeroSuave(cotizacion);
  const acreditado =
    enDolares && montoNum && cotizacionNum?.greaterThan(0) ? montoNum.dividedBy(cotizacionNum) : null;

  return (
    <>
      <input type="hidden" name="entityId" value={entityId} />
      {defaults && <input type="hidden" name="paymentId" value={defaults.paymentId} />}

      {esSocio ? (
        <div className="space-y-1">
          <p className="text-sm">Qué es</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["APORTE_CAPITAL", "Aporte de capital"],
                ["COBRO_PROVEEDOR", "Nos paga algo"],
              ] as const
            ).map(([valor, label]) => (
              <label key={valor} className={toggleClass}>
                <input
                  type="radio"
                  name="concepto"
                  value={valor}
                  checked={concepto === valor}
                  onChange={() => setConcepto(valor)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-foreground/50">
            {concepto === "APORTE_CAPITAL"
              ? "Plata que pone el socio en la empresa. Entra a la caja y baja lo retirado."
              : "Plata que nos paga por algo que le vendimos o le dimos."}
          </p>
        </div>
      ) : (
        <>
          <input type="hidden" name="concepto" value="COBRO_PROVEEDOR" />
          <p className="text-xs text-foreground/50">
            Plata que el proveedor nos paga, por ejemplo por un insumo que le vendimos. Entra a la caja
            y cancela lo que nos debía.
          </p>
        </>
      )}

      <div className="space-y-1">
        <p className="text-sm">Cuenta</p>
        <div className="grid grid-cols-2 gap-2">
          {(["BLANCO", "NEGRO"] as const).map((c) => (
            <label key={c} className={toggleClass}>
              <input
                type="radio"
                name="circuit"
                value={c}
                checked={circuit === c}
                onChange={() => {
                  setCircuit(c);
                  if (!metodoValidoEn(c, method)) setMethod("EFECTIVO");
                }}
                className="sr-only"
              />
              {CIRCUIT_LABELS[c]}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-sm">Cómo entró</p>
        <div className="flex flex-wrap gap-2">
          {metodos.map((m) => (
            <label key={m} className={toggleClass}>
              <input
                type="radio"
                name="method"
                value={m}
                checked={method === m}
                onChange={() => setMethod(m)}
                className="sr-only"
              />
              {PAYMENT_METHOD_LABELS[m]}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="entrada-fecha">
            Fecha
          </label>
          <input
            id="entrada-fecha"
            type="date"
            name="date"
            required
            defaultValue={defaults?.date ?? hoyEnInput()}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="entrada-monto">
            {enDolares ? "Monto en pesos *" : "Monto *"}
          </label>
          <input
            id="entrada-monto"
            name="amount"
            required
            inputMode="decimal"
            placeholder="150.000,00"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {enDolares && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="entrada-cotizacion">
              Cotización *
            </label>
            <input
              id="entrada-cotizacion"
              name="exchangeRate"
              required
              inputMode="decimal"
              placeholder="1.512"
              value={cotizacion}
              onChange={(e) => setCotizacion(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm">Se acredita</p>
            <p className="px-3 py-2 text-sm font-semibold tabular-nums">
              {acreditado ? formatMoney(acreditado, "USD") : "—"}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="entrada-caja">
            A qué caja entró *
          </label>
          <select
            key={circuit}
            id="entrada-caja"
            name="destino"
            required
            defaultValue={cajaPorDefecto}
            className={inputClass}
          >
            {treasuries.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        {method === "TRANSFERENCIA" && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="entrada-operacion">
              N° de operación
            </label>
            <input
              id="entrada-operacion"
              name="numeroOperacion"
              defaultValue={defaults?.numeroOperacion}
              className={inputClass}
            />
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="entrada-referencia">
          Descripción
        </label>
        <input
          id="entrada-referencia"
          name="reference"
          defaultValue={defaults?.reference}
          placeholder={concepto === "APORTE_CAPITAL" ? "Aporte de octubre" : "Pago de la VI-00002"}
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        {defaults ? "Guardar cambios" : "Registrar"}
      </button>
    </>
  );
}
