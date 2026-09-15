"use client";

import { useState } from "react";
import { formatMoney, parseNumeroSuave, ZERO } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700";

/** Lo que cobra de más quien recibió el cheque cuando vuelve rechazado. */
const GASTO_FIJO = "15.000";
const GASTO_PORCENTAJE = "3";

export function RechazoChequeFields({
  chequeId,
  numero,
  monto,
  aQuien,
  deQuien,
}: {
  chequeId: string;
  numero: string;
  /** El valor del cheque, en formato argentino. */
  monto: string;
  /** El proveedor al que se le entregó, si se entregó. */
  aQuien: string | null;
  /** El cliente que lo dio, si vino de uno. */
  deQuien: string | null;
}) {
  const [fijo, setFijo] = useState(aQuien ? GASTO_FIJO : "");
  const [porcentaje, setPorcentaje] = useState(aQuien ? GASTO_PORCENTAJE : "");

  const valor = parseNumeroSuave(monto) ?? ZERO;
  const variable = valor.times(parseNumeroSuave(porcentaje) ?? ZERO).dividedBy(100);
  const fijoNum = parseNumeroSuave(fijo) ?? ZERO;

  return (
    <>
      <input type="hidden" name="chequeId" value={chequeId} />

      <p className="text-sm">
        El cheque <strong>#{numero}</strong> por {formatMoney(valor)} volvió rechazado.
      </p>
      <p className="text-xs text-foreground/50">
        No valía, así que todo lo que se canceló con él vuelve a deberse. Se carga como nota de
        débito y no borrando los pagos: el papel se entregó, y borrar el pago dejaría la cuenta
        cerrando bien pero sin explicar por qué.
      </p>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="date">
          Fecha del rechazo
        </label>
        <input id="date" type="date" name="date" required className={inputClass} />
      </div>

      {aQuien && (
        <div className="space-y-2 rounded-lg border border-foreground/10 p-3">
          <p className="text-sm">
            Gastos que cobra {aQuien}
            <span className="block text-xs text-foreground/50">
              Un fijo más un porcentaje sobre el valor del cheque. Van como dos renglones aparte en
              su cuenta, igual que los manda.
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-foreground/70" htmlFor="gastoFijo">
                Cargo fijo
              </label>
              <input
                id="gastoFijo"
                name="gastoFijo"
                inputMode="decimal"
                value={fijo}
                onChange={(e) => setFijo(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/70" htmlFor="gastoPorcentaje">
                % sobre el valor
              </label>
              <input
                id="gastoPorcentaje"
                name="gastoPorcentaje"
                inputMode="decimal"
                value={porcentaje}
                onChange={(e) => setPorcentaje(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}

      {/* Lo que va a pasar, antes de que pase: son cuentas de terceros. */}
      <div className="space-y-1 rounded-lg border border-foreground/10 p-3 text-sm">
        <p className="font-medium">Se van a cargar estas notas de débito:</p>
        <ul className="space-y-0.5 text-foreground/70">
          {aQuien && (
            <>
              <li className="flex justify-between">
                <span>{aQuien} — se anula el pago</span>
                <span className="tabular-nums">{formatMoney(valor)}</span>
              </li>
              {fijoNum.greaterThan(0) && (
                <li className="flex justify-between">
                  <span>{aQuien} — gastos del rechazo</span>
                  <span className="tabular-nums">{formatMoney(fijoNum)}</span>
                </li>
              )}
              {variable.greaterThan(0) && (
                <li className="flex justify-between">
                  <span>
                    {aQuien} — {porcentaje}% s/valor
                  </span>
                  <span className="tabular-nums">{formatMoney(variable)}</span>
                </li>
              )}
            </>
          )}
          {deQuien && (
            <li className="flex justify-between">
              <span>{deQuien} — se anula el cobro</span>
              <span className="tabular-nums">{formatMoney(valor)}</span>
            </li>
          )}
          {!aQuien && !deQuien && (
            <li className="text-foreground/50">
              Este cheque no vino de un cliente ni se entregó a nadie, así que no hay cuenta que
              corregir — sólo queda marcado como rechazado.
            </li>
          )}
        </ul>
      </div>

      <button type="submit" className={submitClass}>
        Marcar rechazado
      </button>
    </>
  );
}
