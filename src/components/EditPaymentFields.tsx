"use client";

import { useState } from "react";
import type { Circuit, Currency, Entity, PaymentMethod } from "@prisma/client";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { metodosDePago } from "@/lib/pagos";
import { formatMoney, parseNumeroSuave } from "@/lib/money";
import { PaymentDestinoField } from "./PaymentDestinoField";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

export function EditPaymentFields({
  paymentId,
  defaultValues,
  moneda = "ARS",
  treasuries,
  proveedores,
}: {
  paymentId: string;
  /** Moneda de la cuenta del pago: en dólares se edita en pesos y se convierte, igual que al crear. */
  moneda?: Currency;
  defaultValues: {
    circuit: "BLANCO" | "NEGRO";
    method: PaymentMethod;
    date: string;
    amount: string;
    /** La cotización con la que se hizo, si la cuenta va en dólares. */
    exchangeRate?: string;
    reference?: string;
    /** Id de tesorería, PROVEEDOR_DIRECTO_VALUE, o "" si no tiene destino asignado. */
    destino?: string;
    proveedorId?: string;
    /** La cuenta del proveedor que recibió el cobro directo, que puede no ser la de este pago. */
    proveedorCircuit?: Circuit;
  };
  treasuries: Entity[];
  /** Solo si esta cuenta es de un cliente: lista de proveedores, para "directo a un proveedor". */
  proveedores?: Entity[];
}) {
  const isCobro = proveedores !== undefined;

  // Las mismas reglas que al cargar: en negro no hay echeq ni retención, y el banco no es destino.
  const [circuit, setCircuit] = useState<Circuit>(defaultValues.circuit);
  const [method, setMethod] = useState<PaymentMethod>(defaultValues.method);
  const metodos = metodosDePago(circuit, { conRetencion: isCobro });
  // Un pago viejo puede tener un método que hoy no se ofrece —una retención de un pago a proveedor,
  // de antes de que dejara de ofrecerse— y esconderlo lo cambiaría solo al guardar.
  const metodosVisibles = metodos.includes(method) ? metodos : [...metodos, method];

  // Mismo comportamiento que el alta: en una cuenta en dólares se escriben los pesos y la
  // cotización. Al editar se arranca de lo guardado, que ya está en dólares.
  const enDolares = moneda === "USD";
  const [monto, setMonto] = useState(defaultValues.amount);
  const [cotizacion, setCotizacion] = useState(defaultValues.exchangeRate ?? "");
  const montoNum = parseNumeroSuave(monto);
  const cotizacionNum = parseNumeroSuave(cotizacion);
  const acreditado =
    enDolares && montoNum && cotizacionNum?.greaterThan(0) ? montoNum.dividedBy(cotizacionNum) : null;

  return (
    <>
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="isCobro" value={isCobro ? "1" : "0"} />

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
                  if (!metodosDePago(c, { conRetencion: isCobro }).includes(method)) {
                    setMethod("EFECTIVO");
                  }
                }}
                className="sr-only"
              />
              {c === "BLANCO" ? "Blanco (con factura)" : "Negro (sin factura)"}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-sm">Método de pago</p>
        <div className="flex flex-wrap gap-2">
          {metodosVisibles.map((m) => (
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
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required defaultValue={defaultValues.date} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="amount">
            {enDolares ? "Monto en pesos *" : "Monto *"}
          </label>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {enDolares && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="exchangeRate">
              Cotización *
            </label>
            <input
              id="exchangeRate"
              name="exchangeRate"
              required
              inputMode="decimal"
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

      <PaymentDestinoField
        isCobro={isCobro}
        circuit={circuit}
        treasuries={treasuries}
        proveedores={proveedores}
        defaultDestino={defaultValues.destino ?? ""}
        defaultProveedorId={defaultValues.proveedorId}
        defaultProveedorCircuit={defaultValues.proveedorCircuit}
        montoDelCobro={monto}
      />

      <div className="space-y-1">
        <label className="text-sm" htmlFor="reference">
          Descripción
        </label>
        <textarea
          id="reference"
          name="reference"
          rows={2}
          defaultValue={defaultValues.reference}
          className={inputClass}
        />
      </div>

      <p className="text-xs text-foreground/50">
        Si cambiás el monto o la cuenta, se vuelve a imputar por FIFO desde cero.
      </p>

      <button type="submit" className={submitClass}>
        Guardar cambios
      </button>
    </>
  );
}
