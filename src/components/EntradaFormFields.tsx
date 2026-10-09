"use client";

import { useState } from "react";
import type { Circuit, Currency, PaymentConcepto, PaymentMethod } from "@prisma/client";
import { CIRCUIT_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { metodoValidoEn, metodosDePago } from "@/lib/pagos";
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
  cobraDocumentoId: string;
  chequeNumero: string;
  chequeBanco: string;
  chequeFechaCobro: string;
};

/** Una venta de insumo al proveedor que todavía falta cobrar (o la que ya cobra este cobro). */
export type VentaOpcion = { id: string; circuit: Circuit; label: string };

/**
 * Plata que entra desde la cuenta de un proveedor: un cobro (nos paga algo que le vendimos) o, en
 * la cuenta del socio, un aporte de capital. Es el pago al revés, así que pide lo mismo que un cobro
 * —cuenta, monto, cómo y a qué caja, y los datos del cheque si vino uno— pero sin retenciones ni
 * "directo a un proveedor". Un cobro dice además qué venta paga.
 */
export function EntradaFormFields({
  entityId,
  moneda,
  esSocio,
  treasuries,
  ventas = [],
  defaults,
}: {
  entityId: string;
  moneda: Currency;
  /** La cuenta por la que se retira para los socios: ahí también se carga un aporte de capital. */
  esSocio: boolean;
  treasuries: { id: string; name: string }[];
  ventas?: VentaOpcion[];
  defaults?: EntradaDefaults;
}) {
  const [concepto, setConcepto] = useState<PaymentConcepto>(
    defaults?.concepto ?? (esSocio ? "APORTE_CAPITAL" : "COBRO_PROVEEDOR")
  );
  // Arranca en la cuenta de la primera venta que falta cobrar: es casi siempre lo que se viene a cargar.
  const [circuit, setCircuit] = useState<Circuit>(defaults?.circuit ?? ventas[0]?.circuit ?? "NEGRO");
  const [method, setMethod] = useState<PaymentMethod>(defaults?.method ?? "EFECTIVO");
  const [monto, setMonto] = useState(defaults?.amount ?? "");
  const [cotizacion, setCotizacion] = useState(defaults?.exchangeRate ?? "");
  const metodos = metodosDePago(circuit, { conRetencion: false });
  const esCheque = method === "CHEQUE" || method === "ECHEQ";
  const ventasDeLaCuenta = ventas.filter((v) => v.circuit === circuit);
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

      {esCheque && (
        <div className="space-y-2 rounded-lg border border-foreground/10 p-3">
          <p className="text-sm">
            Datos del {method === "ECHEQ" ? "echeq" : "cheque"}
            <span className="block text-xs text-foreground/50">
              Queda en cartera hasta que lo uses para pagarle a alguien. Dejá la fecha vacía si es al día.
            </span>
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-foreground/70" htmlFor="entrada-cheque-numero">
                Número
              </label>
              <input
                id="entrada-cheque-numero"
                name="chequeNumero"
                required
                defaultValue={defaults?.chequeNumero}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/70" htmlFor="entrada-cheque-banco">
                Banco
              </label>
              <input id="entrada-cheque-banco" name="chequeBanco" defaultValue={defaults?.chequeBanco} className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/70" htmlFor="entrada-cheque-fecha">
                Cobrable desde
              </label>
              <input
                id="entrada-cheque-fecha"
                type="date"
                name="chequeFechaCobro"
                defaultValue={defaults?.chequeFechaCobro}
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}

      {concepto === "COBRO_PROVEEDOR" && ventasDeLaCuenta.length > 0 && (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="entrada-venta">
            Qué venta paga
          </label>
          <select
            key={circuit}
            id="entrada-venta"
            name="cobraDocumentoId"
            defaultValue={defaults?.cobraDocumentoId ?? (ventasDeLaCuenta.length === 1 ? ventasDeLaCuenta[0].id : "")}
            className={inputClass}
          >
            <option value="">Cualquiera, la más vieja primero</option>
            {ventasDeLaCuenta.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-foreground/50">Así la venta muestra cuánto falta cobrar de ella.</p>
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
