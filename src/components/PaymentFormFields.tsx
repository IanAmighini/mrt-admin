"use client";

import { useState } from "react";
import type { Circuit, Currency, Entity, PaymentMethod } from "@prisma/client";
import { CIRCUIT_LABELS, PAYMENT_METHOD_LABELS, RETENTION_KIND_LABELS, RETENTION_KIND_ORDER } from "@/lib/labels";
import { metodosDePago } from "@/lib/pagos";
import { ViajeFields, type ViajeOption } from "./ViajeFields";
import { formatMoney, formatNumeroEditable, parseNumeroSuave, ZERO } from "@/lib/money";
import { PaymentDestinoField } from "./PaymentDestinoField";
import { SelectBuscable } from "@/components/ui/SelectBuscable";

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
  viajes,
  defaultViajeId,
  rotuloSubcuenta,
  subcuentasPorEntidad,
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
  /** Los viajes del cliente. Elegir uno acota la imputación a ese viaje. */
  viajes?: ViajeOption[];
  defaultViajeId?: string | null;
  rotuloSubcuenta?: string;
  /** Desde Cobros y Pagos, donde se elige a quién: las subcuentas de los que las tienen (Gonzalo
   * Morosoli por camión, Goloeste el alquiler). El selector aparece sólo si el elegido tiene. */
  subcuentasPorEntidad?: Record<string, { viajes: ViajeOption[]; rotulo: string }>;
}) {
  const isCobro = entityNoun === "Cliente";

  // La moneda de la cuenta cambia qué se pide: en dólares se cargan los pesos que salieron y la
  // cotización, y se acredita la división.
  const [entityId, setEntityId] = useState(fixedEntityId ?? "");
  const subcuentas = viajes ?? subcuentasPorEntidad?.[entityId]?.viajes;
  const rotulo = rotuloSubcuenta ?? subcuentasPorEntidad?.[entityId]?.rotulo;
  const [monto, setMonto] = useState("");
  const [circuit, setCircuit] = useState<Circuit>("BLANCO");
  const [method, setMethod] = useState<PaymentMethod>("EFECTIVO");
  // Los cheques de la cartera que se entregan con este pago: pueden ser varios.
  const [chequeIds, setChequeIds] = useState<string[]>([]);
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
  // Los de la cartera que corresponden al método: echeqs si se paga con echeq, de papel si con cheque.
  const chequesQueSePuedenEntregar = (cartera ?? []).filter((c) => c.esEcheq === (method === "ECHEQ"));
  const elegidos = chequesQueSePuedenEntregar.filter((c) => chequeIds.includes(c.id));
  const sumaElegidos = elegidos.reduce((acc, c) => acc.plus(parseNumeroSuave(c.amount) ?? ZERO), ZERO);

  /** Tildar o destildar un cheque recalcula el monto: el pago es lo que suman, se entregan enteros. */
  function alternarCheque(id: string) {
    const siguientes = chequeIds.includes(id) ? chequeIds.filter((x) => x !== id) : [...chequeIds, id];
    setChequeIds(siguientes);
    const suma = chequesQueSePuedenEntregar
      .filter((c) => siguientes.includes(c.id))
      .reduce((acc, c) => acc.plus(parseNumeroSuave(c.amount) ?? ZERO), ZERO);
    setMonto(siguientes.length > 0 ? formatNumeroEditable(suma) : "");
  }
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
          <SelectBuscable
            id="entityId"
            name="entityId"
            required
            value={entityId}
            onChange={setEntityId}
            opciones={(entities ?? []).map((e) => ({ value: e.id, label: e.name }))}
            placeholder={`Escribí el ${entityNoun?.toLowerCase() ?? "nombre"}…`}
            className={inputClass}
          />
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
                  // Lo elegido puede no existir en la otra cuenta (una retención en negro): se
                  // vuelve al método de siempre en vez de mandarlo con la fila ya escondida.
                  if (!metodosDePago(c, { conRetencion: isCobro }).includes(method)) {
                    setMethod("EFECTIVO");
                  }
                }}
                className="sr-only"
              />
              {CIRCUIT_LABELS[c]}
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
                onChange={() => {
                  setMethod(m);
                  // Los cheques elegidos son de un tipo: al cambiar de método se descartan, y con
                  // ellos el monto que habían completado.
                  if (chequeIds.length > 0) {
                    setChequeIds([]);
                    setMonto("");
                  }
                }}
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
            placeholder="150.000,00"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            readOnly={eligeDeCartera && elegidos.length > 0}
            className={`${inputClass} read-only:bg-foreground/5`}
          />
          {eligeDeCartera && elegidos.length > 0 && (
            <p className="text-xs text-foreground/50">Es lo que suman los cheques elegidos.</p>
          )}
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
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm">
                  {method === "ECHEQ" ? "Echeqs a entregar" : "Cheques a entregar"}
                  <span className="block text-xs text-foreground/50">
                    Tildá uno o varios de la cartera. Se entregan enteros: el pago es lo que suman.
                  </span>
                </p>
                {elegidos.length > 0 && (
                  <p className="shrink-0 text-sm font-medium tabular-nums">
                    {elegidos.length} · {formatMoney(sumaElegidos)}
                  </p>
                )}
              </div>
              {chequesQueSePuedenEntregar.length === 0 ? (
                <p className="text-xs text-foreground/50">
                  No hay {method === "ECHEQ" ? "echeqs" : "cheques"} en cartera. Si es uno que no pasó
                  por la cartera, cargalo abajo.
                </p>
              ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-foreground/10 p-1">
                  {chequesQueSePuedenEntregar.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-foreground/5 has-[:checked]:bg-primary/10"
                    >
                      <input
                        type="checkbox"
                        name="chequeId"
                        value={c.id}
                        checked={chequeIds.includes(c.id)}
                        onChange={() => alternarCheque(c.id)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        #{c.numero}
                        {c.banco ? ` · ${c.banco}` : ""}
                        <span className="text-foreground/50">
                          {c.deQuien ? ` · de ${c.deQuien}` : ""}
                          {c.fechaCobro ? ` · cobrable ${c.fechaCobro}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{c.montoLabel}</span>
                    </label>
                  ))}
                </div>
              )}
              {/* No todo cheque entró por un cobro: los hay propios y los que se consiguen
                  cambiándolos. Obligar a elegir de la cartera dejaba esos pagos sin poder cargarse. */}
              {elegidos.length === 0 && (
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

      {method === "TRANSFERENCIA" && (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="numeroOperacion">
            N° de operación{isCobro ? " *" : ""}
          </label>
          <input
            id="numeroOperacion"
            name="numeroOperacion"
            required={isCobro}
            placeholder="Operación, código de identificación o referencia, según el banco"
            className={inputClass}
          />
          <p className="text-xs text-foreground/50">
            Si el cobro va directo a un proveedor, este número sale en su orden de pago.
          </p>
        </div>
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
          placeholder={esRetencion ? "Número del certificado de retención" : `Observaciones del ${isCobro ? "cobro" : "pago"}...`}
          className={inputClass}
        />
      </div>

      <ViajeFields
        key={entityId}
        viajes={subcuentas}
        mostrarDestinatario={false}
        rotulo={rotulo}
        defaultViajeId={defaultViajeId}
        ayudaViaje={`El ${isCobro ? "cobro" : "pago"} cancela comprobantes de ${(rotulo ?? "ese viaje").toLowerCase() === "viaje" ? "ese viaje" : `esa ${(rotulo ?? "").toLowerCase()}`} y de ninguna otra parte. Sin elegir nada, sólo cancela lo que tampoco la tiene.`}
      />

      <button type="submit" className={submitClass}>
        {isCobro ? "Registrar cobro" : "Registrar pago"}
      </button>
    </>
  );
}
