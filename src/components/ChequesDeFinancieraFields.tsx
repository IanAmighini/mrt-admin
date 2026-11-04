"use client";

import { useState } from "react";
import type { Circuit } from "@prisma/client";
import { formatMoney, formatNumeroEditable, parseNumeroSuave, ZERO } from "@/lib/money";
import { hoyEnInput } from "@/lib/period";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { rendimientoDeFinanciera } from "@/lib/financiera";
import { FilasDeCheques, filasIniciales, type FilaDeCheque } from "@/components/CambioChequesFields";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

export type FinancieraParaRetirar = {
  id: string;
  name: string;
  /** Lo que nos debe en cada cuenta —lo transferido y todavía no retirado—, como se escribe. */
  aFavor: Record<Circuit, string>;
};

const CUENTAS: Circuit[] = ["BLANCO", "NEGRO"];
/** La cuenta donde está lo que nos debe; si está en las dos, la de más. */
const cuentaConSaldo = (f: FinancieraParaRetirar | undefined): Circuit => {
  const [b, n] = CUENTAS.map((c) => parseNumeroSuave(f?.aFavor[c] ?? "") ?? ZERO);
  return b.greaterThan(n) ? "BLANCO" : "NEGRO";
};
const aFavorDe = (f: FinancieraParaRetirar | undefined, c: Circuit) => {
  const v = parseNumeroSuave(f?.aFavor[c] ?? "") ?? ZERO;
  return v.greaterThan(0) ? v : ZERO;
};

/**
 * Retirar los cheques de una financiera. Lo que los clientes le transfirieron ya está en su cuenta
 * —a favor nuestro—, así que se cargan los cheques y cuánto de ese saldo cancelan (por defecto,
 * todo). La diferencia es la ganancia, y se muestra antes de guardar.
 */
export function ChequesDeFinancieraFields({ financieras }: { financieras: FinancieraParaRetirar[] }) {
  const [entityId, setEntityId] = useState(financieras[0]?.id ?? "");
  const financiera = financieras.find((f) => f.id === entityId);
  const [circuit, setCircuit] = useState<Circuit>(cuentaConSaldo(financieras[0]));
  const [cancela, setCancela] = useState(formatNumeroEditable(aFavorDe(financieras[0], circuit)));
  const [filas, setFilas] = useState<FilaDeCheque[]>(filasIniciales);

  // Cambiar de financiera o de cuenta vuelve a proponer todo lo que debe ahí.
  const elegir = (id: string, c?: Circuit) => {
    const f = financieras.find((x) => x.id === id);
    const cuenta = c ?? cuentaConSaldo(f);
    setEntityId(id);
    setCircuit(cuenta);
    setCancela(formatNumeroEditable(aFavorDe(f, cuenta)));
  };

  if (financieras.length === 0) {
    return (
      <p className="text-sm text-foreground/60">
        Todavía no hay ninguna financiera. Se da de alta como proveedor, con la casilla «Es una financiera».
      </p>
    );
  }

  const cancelado = parseNumeroSuave(cancela) ?? ZERO;
  const debe = aFavorDe(financiera, circuit);
  const { total, ganancia, pct } = rendimientoDeFinanciera({
    fecha: null,
    transferencia: cancelado,
    cheques: filas.map((f) => ({ monto: parseNumeroSuave(f.monto) ?? ZERO, fechaCobro: null })),
  });
  const completo = cancelado.greaterThan(0) && total.greaterThan(0);

  return (
    <>
      <p className="text-xs text-foreground/50">
        Lo que los clientes le transfirieron ya está en la cuenta de la financiera, a favor nuestro. Los cheques entran en cartera a{" "}
        <strong>Caja Bufano</strong>, y lo que valen de más es un <strong>ingreso financiero</strong>: suma al resultado del mes.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="entityId">
            Financiera
          </label>
          <select id="entityId" name="entityId" value={entityId} onChange={(e) => elegir(e.target.value)} className={inputClass}>
            {financieras.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha en que se retiraron
          </label>
          <input id="date" type="date" name="date" required defaultValue={hoyEnInput()} className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="circuit">
            Cuenta
          </label>
          <select
            id="circuit"
            name="circuit"
            value={circuit}
            onChange={(e) => elegir(entityId, e.target.value as Circuit)}
            className={inputClass}
          >
            {CUENTAS.map((c) => (
              <option key={c} value={c}>
                {CIRCUIT_LABELS[c].split(" (")[0]} — nos debe {formatMoney(aFavorDe(financiera, c))}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="cancela">
            Cancelan del saldo
          </label>
          <input
            id="cancela"
            name="cancela"
            required
            inputMode="decimal"
            value={cancela}
            onChange={(e) => setCancela(e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-foreground/50">Lo transferido que cubren estos cheques. Por defecto, todo lo que debe.</p>
        </div>
      </div>

      <FilasDeCheques filas={filas} setFilas={setFilas} />

      <div className="space-y-1 border-t border-foreground/10 pt-3 text-sm tabular-nums">
        <div className="flex items-baseline justify-between">
          <span>Cheques</span>
          <span>{formatMoney(total)}</span>
        </div>
        <div className="flex items-baseline justify-between text-foreground/60">
          <span>Cancelan del saldo</span>
          <span>− {formatMoney(cancelado)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span>
            Ingreso financiero
            {completo && pct && !ganancia.isNegative() && (
              <span className="ml-2 text-xs text-foreground/50">{formatNumeroEditable(pct)}% sobre lo transferido</span>
            )}
          </span>
          <span className={`text-lg font-semibold ${completo && ganancia.isNegative() ? "text-red-600 dark:text-red-400" : ""}`}>
            {formatMoney(ganancia)}
          </span>
        </div>
        {completo && ganancia.isNegative() && (
          <p className="text-xs text-red-600 dark:text-red-400">Los cheques suman menos que lo que cancelan: revisá los montos.</p>
        )}
        {cancelado.greaterThan(debe) && (
          <p className="text-xs text-red-600 dark:text-red-400">
            Nos debe {formatMoney(debe)} en esta cuenta: si falta el cobro directo de un cliente, cargalo primero.
          </p>
        )}
      </div>

      <button type="submit" className={submitClass}>
        Registrar cheques
      </button>
    </>
  );
}
