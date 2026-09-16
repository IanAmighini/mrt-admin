"use client";

import { useState } from "react";
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_ORDER,
  TREASURY_MOVEMENT_CATEGORY_LABELS,
} from "@/lib/labels";
import { formatMoney, parseNumeroSuave, ZERO } from "@/lib/money";
import { computeGastoTotals, filasDesdeValores } from "@/lib/impuestos";
import { ImpuestosFields, impuestosIniciales, type ImpuestosValores } from "./ImpuestosFields";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

// "Pase entre cajas" no está: un pase tiene dos patas y se carga desde la pantalla de caja, que
// escribe las dos juntas. Cargado acá quedaría media plata en el aire.
const MANUAL_TREASURY_CATEGORIES = ["GASTO", "GASTO_BANCARIO", "IMPUESTO", "RETIRO", "DEPOSITO", "AJUSTE_ARQUEO", "OTRO"] as const;

type TipoMovimiento = "NOTA_CREDITO" | "NOTA_DEBITO" | "AJUSTE";
type CircuitoMovimiento = "BLANCO" | "NEGRO";

export type DocumentDefaults = {
  type?: TipoMovimiento;
  number?: string;
  date?: string;
  dueDate?: string;
  currency?: string;
  exchangeRate?: string;
  /** El neto en Blanco, el monto en Negro y en los ajustes. */
  amount?: string;
  ajusteEffect?: "SUMA" | "RESTA";
  treasuryCategory?: string;
  expenseCategory?: string;
  reason?: string;
  impuestos?: ImpuestosValores;
};

/**
 * Alta y edición de una nota de crédito/débito o un ajuste. Un mismo componente para las dos cosas
 * porque los campos son los mismos: tenerlos separados ya hizo que se desincronizaran.
 *
 * Una nota en Blanco es un comprobante fiscal y lleva el IVA discriminado, así que entra al libro.
 * En Negro, y los ajustes en cualquier circuito, van por monto y quedan fuera.
 */
export function DocumentFormFields({
  fixedEntityId,
  isTreasury,
  editingDocumentId,
  circuitoFijo,
  defaultValues,
}: {
  fixedEntityId?: string;
  isTreasury?: boolean;
  /** Si viene, el formulario edita ese comprobante en vez de crear uno nuevo. */
  editingDocumentId?: string;
  /** Al editar: el circuito de la cuenta, que no se puede cambiar desde acá. */
  circuitoFijo?: CircuitoMovimiento;
  defaultValues?: DocumentDefaults;
}) {
  const esEdicion = Boolean(editingDocumentId);
  const [type, setType] = useState<TipoMovimiento>(defaultValues?.type ?? "NOTA_CREDITO");
  const [circuit, setCircuit] = useState<CircuitoMovimiento>(circuitoFijo ?? "BLANCO");
  const [currency, setCurrency] = useState(defaultValues?.currency ?? "ARS");
  const [treasuryCategory, setTreasuryCategory] = useState(defaultValues?.treasuryCategory ?? "");
  const [monto, setMonto] = useState(defaultValues?.amount ?? "");
  const [impuestos, setImpuestos] = useState<ImpuestosValores>(() => impuestosIniciales(defaultValues?.impuestos));

  const esNota = type !== "AJUSTE";
  const conIva = esNota && circuit === "BLANCO";

  const desglose = computeGastoTotals(
    filasDesdeValores(impuestos),
    parseNumeroSuave(impuestos.retentionAmount ?? "") ?? ZERO
  );
  const total = conIva ? desglose.totalAmount : (parseNumeroSuave(monto) ?? ZERO);

  return (
    <>
      {fixedEntityId && <input type="hidden" name="entityId" value={fixedEntityId} />}
      {editingDocumentId && <input type="hidden" name="documentId" value={editingDocumentId} />}

      {!esEdicion && (
        <div className="space-y-1">
          <p className="text-sm">Cuenta</p>
          <div className="grid grid-cols-2 gap-2">
            <label className={toggleClass}>
              <input
                type="radio"
                name="circuit"
                value="BLANCO"
                checked={circuit === "BLANCO"}
                onChange={() => setCircuit("BLANCO")}
                className="sr-only"
              />
              Blanco (con factura)
            </label>
            <label className={toggleClass}>
              <input
                type="radio"
                name="circuit"
                value="NEGRO"
                checked={circuit === "NEGRO"}
                onChange={() => setCircuit("NEGRO")}
                className="sr-only"
              />
              Negro (sin factura)
            </label>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-sm" htmlFor="type">
          Tipo
        </label>
        <select
          id="type"
          name="type"
          required
          value={type}
          onChange={(e) => setType(e.target.value as TipoMovimiento)}
          className={inputClass}
        >
          <option value="NOTA_CREDITO">Nota de crédito</option>
          <option value="NOTA_DEBITO">Nota de débito</option>
          <option value="AJUSTE">Ajuste manual</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="number">
            Número
          </label>
          <input id="number" name="number" required defaultValue={defaultValues?.number} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required defaultValue={defaultValues?.date} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="dueDate">
            Vencimiento (opcional)
          </label>
          <input id="dueDate" type="date" name="dueDate" defaultValue={defaultValues?.dueDate} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="currency">
            Moneda
          </label>
          <select
            id="currency"
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClass}
          >
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </div>
        {currency === "USD" && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="exchangeRate">
              Cotización
            </label>
            <input
              id="exchangeRate"
              name="exchangeRate"
              inputMode="decimal"
              defaultValue={defaultValues?.exchangeRate}
              className={inputClass}
            />
          </div>
        )}
        {/* En Blanco el neto lo carga la grilla de abajo, abierto por alícuota. Acá sólo queda el
            monto de los casos que no llevan desglose: las notas en Negro y los ajustes. */}
        {!conIva && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="amount">
              Monto
            </label>
            <input
              id="amount"
              name="amount"
              required
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="150.000,50"
              className={inputClass}
            />
          </div>
        )}
        {!esNota && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="ajusteEffect">
              Efecto
            </label>
            <select
              id="ajusteEffect"
              name="ajusteEffect"
              defaultValue={defaultValues?.ajusteEffect ?? "SUMA"}
              className={inputClass}
            >
              <option value="SUMA">Suma al saldo</option>
              <option value="RESTA">Resta al saldo</option>
            </select>
          </div>
        )}
        {isTreasury && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="treasuryCategory">
              Categoría
            </label>
            <select
              id="treasuryCategory"
              name="treasuryCategory"
              value={treasuryCategory}
              onChange={(e) => setTreasuryCategory(e.target.value)}
              className={inputClass}
            >
              <option value="">— Elegir —</option>
              {MANUAL_TREASURY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {TREASURY_MOVEMENT_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* El rubro es lo que hace que el gasto de caja cuente como gasto del mes por categoría,
            igual que la factura de un proveedor. */}
        {isTreasury && treasuryCategory === "GASTO" && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="expenseCategory">
              Rubro
            </label>
            <select
              id="expenseCategory"
              name="expenseCategory"
              defaultValue={defaultValues?.expenseCategory ?? ""}
              className={inputClass}
            >
              <option value="">— Sin rubro —</option>
              {EXPENSE_CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {EXPENSE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {conIva && (
        <>
          <ImpuestosFields
            defaults={defaultValues?.impuestos}
            onChange={setImpuestos}
            titulo="Desglose de la nota"
            aclaracion="Una nota en Blanco es un comprobante fiscal: el neto va abierto por alícuota y entra así al libro de IVA."
          />
          <div className="flex items-baseline justify-between border-t border-foreground/10 pt-3">
            <span className="text-sm">Total</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatMoney(total, currency as "ARS" | "USD")}
            </span>
          </div>
        </>
      )}

      <div className="space-y-1">
        <label className="text-sm" htmlFor="reason">
          {esNota ? "Motivo (opcional)" : "Motivo"}
        </label>
        <input id="reason" name="reason" defaultValue={defaultValues?.reason} className={inputClass} />
      </div>

      <button type="submit" className={submitClass}>
        {esEdicion ? "Guardar cambios" : "Crear"}
      </button>
    </>
  );
}
