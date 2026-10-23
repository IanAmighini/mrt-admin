"use client";

import { useState } from "react";
import type { Circuit, Entity } from "@prisma/client";
import { PROVEEDOR_DIRECTO_VALUE } from "@/lib/payment-destino";
import { formatMoney, parseNumeroSuave } from "@/lib/money";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { segmentoClass, segmentosClass } from "./ui/Segmentos";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";


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
  defaultCotizacionProveedor,
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
  /** Al editar un cobro directo a un proveedor en dólares: la cotización con que se le acreditó. */
  defaultCotizacionProveedor?: string;
}) {
  const [destino, setDestino] = useState(defaultDestino);
  const [proveedorId, setProveedorId] = useState(defaultProveedorId ?? "");
  const [proveedorCircuit, setProveedorCircuit] = useState<Circuit>(
    defaultProveedorCircuit ?? circuit
  );
  // Al editar arranca con la que se usó: vacía obligaba a escribirla de nuevo, y si no era la misma
  // el cobro le acreditaba otros dólares al proveedor.
  const [cotizacion, setCotizacion] = useState(defaultCotizacionProveedor ?? "");
  const showProveedores = isCobro && destino === PROVEEDOR_DIRECTO_VALUE && proveedores && proveedores.length > 0;

  // Todas las cajas, con cualquier cuenta: se paga en Negro desde el Galicia y en Blanco desde Bufano.
  const disponibles = treasuries;

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
      {/* Las cajas como botones: son tres y se elige con un clic, en vez de abrir una lista. */}
      <div className="space-y-1">
        <p className="text-sm">{isCobro ? "Entra a" : "Sale de"}</p>
        <div className={segmentosClass} role="radiogroup" aria-label={isCobro ? "Destino" : "Origen"}>
          {disponibles.map((t) => (
            <label key={t.id} className={segmentoClass}>
              <input
                type="radio"
                name="destino"
                value={t.id}
                checked={destino === t.id}
                onChange={() => setDestino(t.id)}
                className="sr-only"
              />
              {t.name}
            </label>
          ))}
          {isCobro && proveedores && proveedores.length > 0 && (
            <label className={segmentoClass}>
              <input
                type="radio"
                name="destino"
                value={PROVEEDOR_DIRECTO_VALUE}
                checked={destino === PROVEEDOR_DIRECTO_VALUE}
                onChange={() => setDestino(PROVEEDOR_DIRECTO_VALUE)}
                className="sr-only"
              />
              Directo a un proveedor o empleado
            </label>
          )}
          {/* Sólo para corregir uno viejo que quedó sin caja: uno nuevo siempre entra o sale de alguna. */}
          {defaultDestino === "" && (
            <label className={segmentoClass}>
              <input
                type="radio"
                name="destino"
                value=""
                checked={destino === ""}
                onChange={() => setDestino("")}
                className="sr-only"
              />
              Sin asignar
            </label>
          )}
        </div>
      </div>

      {showProveedores && (
        <>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="proveedorId">
              Proveedor o empleado
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
                  {/* "Cristian", el empleado, al lado de "Cristian Amighini": sin esto se confunden. */}
                  {p.formaDeSueldo ? `${p.name} (empleado)` : p.name}
                </option>
              ))}
            </select>
          </div>

          {/* La plata no cambia de cuenta por pasar de mano: un cobro en negro puede cancelar
              perfectamente una factura en blanco del proveedor, y ahí el cobro y el pago quedan en
              cuentas distintas. Por eso se pregunta en vez de copiar la del cobro. */}
          <div className="space-y-1">
            <p className="text-sm">Cuenta del proveedor</p>
            <div className={segmentosClass}>
              {(["BLANCO", "NEGRO"] as const).map((c) => (
                <label key={c} className={segmentoClass}>
                  <input
                    type="radio"
                    name="proveedorCircuit"
                    value={c}
                    checked={proveedorCircuit === c}
                    onChange={() => setProveedorCircuit(c)}
                    className="sr-only"
                  />
                  {CIRCUIT_LABELS[c]}
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
