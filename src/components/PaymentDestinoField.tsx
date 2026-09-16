"use client";

import { useState } from "react";
import type { Circuit, Entity } from "@prisma/client";
import { PROVEEDOR_DIRECTO_VALUE } from "@/lib/payment-destino";
import { motivoTesoreriaInvalida } from "@/lib/pagos";
import { formatMoney, parseNumeroSuave } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

/** Selector de Destino/Origen de un cobro o pago. Si se elige "Proveedor" (solo disponible para
 * cobros, con la opción "directo a un proveedor"), despliega el selector de a qué proveedor fue. */
export function PaymentDestinoField({
  isCobro,
  circuit,
  treasuries,
  proveedores,
  defaultDestino,
  defaultProveedorId,
  defaultProveedorCircuit,
  montoDelCobro,
}: {
  isCobro: boolean;
  /** La cuenta del pago: en negro el banco no es una opción. */
  circuit: Circuit;
  /** Lo que se está cobrando, para mostrar cuánto se le acredita al proveedor si su cuenta va en
   * otra moneda. Sólo se usa para la vista previa; el cálculo lo rehace el servidor. */
  montoDelCobro?: string;
  treasuries: Entity[];
  /** Solo si esta cuenta es de un cliente: lista de proveedores, para la opción "Proveedor". */
  proveedores?: Entity[];
  defaultDestino: string;
  defaultProveedorId?: string;
  defaultProveedorCircuit?: Circuit;
}) {
  const [destino, setDestino] = useState(defaultDestino);
  const [proveedorId, setProveedorId] = useState(defaultProveedorId ?? "");
  const [proveedorCircuit, setProveedorCircuit] = useState<Circuit>(
    defaultProveedorCircuit ?? circuit
  );
  const [cotizacion, setCotizacion] = useState("");
  const showProveedores = isCobro && destino === PROVEEDOR_DIRECTO_VALUE && proveedores && proveedores.length > 0;

  // Lo que entra o sale del banco queda registrado, así que en negro la única tesorería es la caja.
  const disponibles = treasuries.filter((t) => !motivoTesoreriaInvalida(circuit, t.name));

  // Cambiar de cuenta puede dejar elegido un destino que ya no existe en la lista. Se corrige en el
  // render (el patrón de React para estado que depende de una prop) y no con un efecto, que
  // mostraría un frame con el destino inválido todavía seleccionado.
  const [circuitPrevio, setCircuitPrevio] = useState<Circuit>(circuit);
  if (circuitPrevio !== circuit) {
    setCircuitPrevio(circuit);
    setProveedorCircuit(circuit);
    if (destino && destino !== PROVEEDOR_DIRECTO_VALUE && !disponibles.some((t) => t.id === destino)) {
      setDestino(disponibles[0]?.id ?? "");
    }
  }

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
          {disponibles.map((t) => (
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
        <>
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

          {/* La plata no cambia de cuenta por pasar de mano: un cobro en negro puede cancelar
              perfectamente una factura en blanco del proveedor, y ahí el cobro y el pago quedan en
              cuentas distintas. Por eso se pregunta en vez de copiar la del cobro. */}
          <div className="space-y-1">
            <p className="text-sm">Cuenta del proveedor</p>
            <div className="grid grid-cols-2 gap-2">
              {(["BLANCO", "NEGRO"] as const).map((c) => (
                <label key={c} className={toggleClass}>
                  <input
                    type="radio"
                    name="proveedorCircuit"
                    value={c}
                    checked={proveedorCircuit === c}
                    onChange={() => setProveedorCircuit(c)}
                    className="sr-only"
                  />
                  {c === "BLANCO" ? "Blanco (con factura)" : "Negro (sin factura)"}
                </label>
              ))}
            </div>
            <p className="text-xs text-foreground/50">
              Qué deuda {proveedor ? `de ${proveedor.name}` : "del proveedor"} se cancela. No tiene
              por qué ser la misma cuenta desde la que se cobró.
            </p>
          </div>
        </>
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
