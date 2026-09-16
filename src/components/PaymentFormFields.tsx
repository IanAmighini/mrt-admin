"use client";

import { useState } from "react";
import type { Circuit, Currency, Entity, PaymentMethod } from "@prisma/client";
import { PAYMENT_METHOD_LABELS, RETENTION_KIND_LABELS, RETENTION_KIND_ORDER } from "@/lib/labels";
import { metodosDePago } from "@/lib/pagos";
import { formatMoney, parseNumeroSuave } from "@/lib/money";
import { PaymentDestinoField } from "./PaymentDestinoField";

/** Lo mínimo de un cheque para poder elegirlo; ya serializado, porque esto corre en el navegador. */
export type ChequeEnCartera = {
  id: string;
  numero: string;
  banco: string | null;
  esEcheq: boolean;
  /** El monto tal como lo lee el campo de importe, en formato argentino. */
  amount: string;
  montoLabel: string;
  deQuien: string | null;
  fechaCobro: string | null;
};

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

export function PaymentFormFields({
  entities,
  entityNoun,
  fixedEntityId,
  moneda,
  treasuries,
  proveedores,
  cartera,
}: {
  entities?: Entity[];
  entityNoun?: string;
  fixedEntityId?: string;
  /** Moneda de la cuenta cuando la entidad viene fija. Con desplegable sale de la elegida. */
  moneda?: Currency;
  /** Las 2 entidades TESORERIA (Banco Galicia, Caja Bufano) — para el selector de destino/origen. */
  treasuries: Entity[];
  /** Solo para cobros de clientes: lista de proveedores, para la opción "directo a un proveedor". */
  proveedores?: Entity[];
  /** Los cheques en cartera, para entregarle uno a un proveedor. */
  cartera?: ChequeEnCartera[];
}) {
  const isCobro = entityNoun === "Cliente";

  // La moneda de la cuenta cambia qué se pide: en dólares se cargan los pesos que salieron y la
  // cotización, y se acredita la división.
  const [entityId, setEntityId] = useState(fixedEntityId ?? "");
  const [monto, setMonto] = useState("");
  const [circuit, setCircuit] = useState<Circuit>("BLANCO");
  const [method, setMethod] = useState<PaymentMethod>("EFECTIVO");
  const [chequeId, setChequeId] = useState("");
  // En negro no hay echeq ni retención, así que la fila de métodos es más corta. Una retención la
  // practica el cliente al pagarnos: no existe cuando el que paga sos vos.
  const metodos = metodosDePago(circuit, { conRetencion: isCobro });
  // El banco no recibe plata en negro, así que ahí la caja es el único destino posible.
  const defaultTreasuryId =
    (circuit === "NEGRO"
      ? treasuries.find((t) => t.name !== "Banco Galicia")
      : treasuries.find((t) => t.name === "Banco Galicia")
    )?.id ??
    treasuries[0]?.id ??
    "";
  const esRetencion = method === "RETENCION";
  const esCheque = method === "CHEQUE" || method === "ECHEQ";
  // Al cobrar, el cheque entra y hay que describirlo. Al pagar, sale de la cartera: se elige uno de
  // los que ya están, y así el mismo papel queda con su origen y su destino.
  const eligeDeCartera = esCheque && !isCobro;
  // Entregar un echeq para cancelar una deuda en negro es la misma contradicción que cargarlo como
  // método: queda registrado en el banco. Se saca de la lista en vez de dejar elegirlo y fallar.
  const chequesQueSePuedenEntregar = (cartera ?? []).filter(
    (c) => circuit === "BLANCO" || !c.esEcheq
  );
  const [cotizacion, setCotizacion] = useState("");
  const monedaCuenta: Currency =
    moneda ?? entities?.find((e) => e.id === entityId)?.moneda ?? "ARS";
  const enDolares = monedaCuenta === "USD";

  const montoNum = parseNumeroSuave(monto);
  const cotizacionNum = parseNumeroSuave(cotizacion);
  const acreditado =
    enDolares && montoNum && cotizacionNum?.greaterThan(0)
      ? montoNum.dividedBy(cotizacionNum)
      : null;

  return (
    <>
      <input type="hidden" name="isCobro" value={isCobro ? "1" : "0"} />
      {fixedEntityId ? (
        <input type="hidden" name="entityId" value={fixedEntityId} />
      ) : (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="entityId">
            {entityNoun} *
          </label>
          <select
            id="entityId"
            name="entityId"
            required
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Seleccionar {entityNoun?.toLowerCase()}...
            </option>
            {entities?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
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
                  // Lo elegido puede no existir en la otra cuenta: se vuelve al método de siempre
                  // en vez de mandar un echeq en negro con la fila ya escondida.
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
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required className={inputClass} />
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
            placeholder="0.00"
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
          {eligeDeCartera ? (
            <>
              <p className="text-sm">
                Cheque a entregar
                <span className="block text-xs text-foreground/50">
                  El monto del pago tiene que ser el del cheque: se entrega entero.
                </span>
              </p>
              <select
                name="chequeId"
                value={chequeId}
                onChange={(e) => {
                  setChequeId(e.target.value);
                  const elegido = cartera?.find((c) => c.id === e.target.value);
                  if (elegido) setMonto(elegido.amount);
                }}
                className={inputClass}
              >
                <option value="">— Es un cheque que no está en cartera —</option>
                {chequesQueSePuedenEntregar.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.numero}
                    {c.banco ? ` · ${c.banco}` : ""} · {c.montoLabel}
                    {c.deQuien ? ` · de ${c.deQuien}` : ""}
                    {c.fechaCobro ? ` · cobrable ${c.fechaCobro}` : ""}
                  </option>
                ))}
              </select>
              {/* No todo cheque entró por un cobro: los hay propios y los que se consiguen
                  cambiándolos. Obligar a elegir de la cartera dejaba esos pagos sin poder cargarse. */}
              {!chequeId && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="space-y-1">
                    <label className="text-xs text-foreground/70" htmlFor="chequeNumero">
                      Número
                    </label>
                    <input id="chequeNumero" name="chequeNumero" required className={inputClass} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-foreground/70" htmlFor="chequeBanco">
                      Banco
                    </label>
                    <input id="chequeBanco" name="chequeBanco" className={inputClass} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-foreground/70" htmlFor="chequeFechaCobro">
                      Cobrable desde
                    </label>
                    <input id="chequeFechaCobro" type="date" name="chequeFechaCobro" className={inputClass} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-sm">
                Datos del cheque
                <span className="block text-xs text-foreground/50">
                  Queda en cartera hasta que lo uses para pagarle a alguien.
                </span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-foreground/70" htmlFor="chequeNumero">
                    Número
                  </label>
                  <input id="chequeNumero" name="chequeNumero" required className={inputClass} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-foreground/70" htmlFor="chequeBanco">
                    Banco
                  </label>
                  <input id="chequeBanco" name="chequeBanco" className={inputClass} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-foreground/70" htmlFor="chequeFechaCobro">
                    Cobrable desde
                  </label>
                  <input id="chequeFechaCobro" type="date" name="chequeFechaCobro" className={inputClass} />
                </div>
              </div>
              <p className="text-xs text-foreground/50">
                Dejá la fecha vacía si es al día.
              </p>
            </>
          )}
        </div>
      )}

      {/* Una retención no es plata: no entró a ninguna caja, así que no tiene destino. Mostrar el
          selector invitaría a imputarla a Banco y dejar la tesorería contando plata que no llegó. */}
      {esRetencion ? (
        <div className="space-y-1 rounded-lg border border-foreground/10 p-3">
          <p className="text-sm">
            Tipo de retención
            <span className="block text-xs text-foreground/50">
              Cancela la deuda del cliente igual que un pago, pero no entra a ninguna caja: es un
              crédito contra tu propio impuesto.
            </span>
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {RETENTION_KIND_ORDER.map((kind, i) => (
              <label key={kind} className={toggleClass}>
                <input
                  type="radio"
                  name="retentionKind"
                  value={kind}
                  defaultChecked={i === 0}
                  className="sr-only"
                />
                {RETENTION_KIND_LABELS[kind]}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <PaymentDestinoField
          isCobro={isCobro}
          circuit={circuit}
          treasuries={treasuries}
          proveedores={proveedores}
          defaultDestino={defaultTreasuryId}
          montoDelCobro={monto}
        />
      )}

      <div className="space-y-1">
        <label className="text-sm" htmlFor="reference">
          {esRetencion ? "Nº de certificado" : "Descripción"}
        </label>
        <textarea
          id="reference"
          name="reference"
          rows={2}
          required={esRetencion}
          placeholder={esRetencion ? "Número del certificado de retención" : "Observaciones del pago..."}
          className={inputClass}
        />
      </div>

      <button type="submit" className={submitClass}>
        Registrar pago
      </button>
    </>
  );
}
