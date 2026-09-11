"use client";

import { useState } from "react";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_ORDER } from "@/lib/labels";
import { ALICUOTAS_IVA, OTROS_TRIBUTOS, computeGastoTotals, filasDesdeValores } from "@/lib/gasto";
import { formatMoney, parseNumeroSuave, ZERO } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const smallInputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

export type GastoDefaults = {
  circuit?: "BLANCO" | "NEGRO";
  expenseCategory?: string;
  reason?: string;
  number?: string;
  date?: string;
  dueDate?: string;
  currency?: string;
  exchangeRate?: string;
  /** Solo en negro. */
  amount?: string;
  retentionAmount?: string;
  /** Los montos del desglose, con las mismas claves que los campos: `ivaBase_21`, `percepcionIibb`… */
  tributos?: Record<string, string>;
};

export function GastoFormFields({
  entityId,
  editingDocumentId,
  defaultValues,
}: {
  entityId: string;
  /** Si viene, el formulario edita ese gasto en vez de crear uno nuevo. */
  editingDocumentId?: string;
  defaultValues?: GastoDefaults;
}) {
  const [circuit, setCircuit] = useState<"BLANCO" | "NEGRO">(defaultValues?.circuit ?? "BLANCO");
  const [currency, setCurrency] = useState(defaultValues?.currency ?? "ARS");
  const [montos, setMontos] = useState<Record<string, string>>(defaultValues?.tributos ?? {});
  const [retencion, setRetencion] = useState(defaultValues?.retentionAmount ?? "");
  const [montoNegro, setMontoNegro] = useState(defaultValues?.amount ?? "");

  const setMonto = (name: string, value: string) =>
    setMontos((previos) => ({ ...previos, [name]: value }));

  const totals =
    circuit === "NEGRO"
      ? null
      : computeGastoTotals(filasDesdeValores(montos), parseNumeroSuave(retencion) ?? ZERO);
  const totalVivo =
    circuit === "NEGRO" ? (parseNumeroSuave(montoNegro) ?? ZERO) : totals!.totalAmount;

  return (
    <>
      <input type="hidden" name="entityId" value={entityId} />
      {editingDocumentId && <input type="hidden" name="documentId" value={editingDocumentId} />}

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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="expenseCategory">
            Rubro
          </label>
          <select
            id="expenseCategory"
            name="expenseCategory"
            required
            defaultValue={defaultValues?.expenseCategory ?? ""}
            className={inputClass}
          >
            <option value="">— Elegir —</option>
            {EXPENSE_CATEGORY_ORDER.map((categoria) => (
              <option key={categoria} value={categoria}>
                {EXPENSE_CATEGORY_LABELS[categoria]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="reason">
            Concepto
          </label>
          <input
            id="reason"
            name="reason"
            defaultValue={defaultValues?.reason ?? ""}
            placeholder="Viajes de agosto"
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="number">
            {circuit === "BLANCO" ? "Número de factura" : "Número o referencia (opcional)"}
          </label>
          <input
            id="number"
            name="number"
            required={circuit === "BLANCO"}
            defaultValue={defaultValues?.number ?? ""}
            placeholder={circuit === "BLANCO" ? "A-0001-00001234" : "S/N"}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input
            id="date"
            type="date"
            name="date"
            required
            defaultValue={defaultValues?.date ?? ""}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="dueDate">
            Vencimiento (opcional)
          </label>
          <input
            id="dueDate"
            type="date"
            name="dueDate"
            defaultValue={defaultValues?.dueDate ?? ""}
            className={inputClass}
          />
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
              defaultValue={defaultValues?.exchangeRate ?? ""}
              className={inputClass}
            />
          </div>
        )}
        {circuit === "NEGRO" && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="amount">
              Monto
            </label>
            <input
              id="amount"
              name="amount"
              required
              inputMode="decimal"
              value={montoNegro}
              onChange={(e) => setMontoNegro(e.target.value)}
              placeholder="150.000,50"
              className={inputClass}
            />
          </div>
        )}
      </div>

      {circuit === "BLANCO" && (
        <div className="space-y-2 rounded-lg border border-foreground/10 p-3">
          <p className="text-sm font-medium">Desglose de la factura</p>
          <p className="text-xs text-foreground/50">
            Cargá el neto gravado de cada alícuota que traiga la factura. La mayoría trae una sola.
          </p>

          <div className="space-y-1">
            {ALICUOTAS_IVA.map((alicuota) => {
              const campo = `ivaBase_${alicuota}`;
              const base = parseNumeroSuave(montos[campo] ?? "") ?? ZERO;
              const iva = base.times(parseNumeroSuave(alicuota)!).dividedBy(100);
              return (
                <div key={alicuota} className="grid grid-cols-[5rem_1fr_7rem] items-center gap-2">
                  <span className="text-sm text-foreground/70">IVA {alicuota}%</span>
                  <input
                    name={campo}
                    inputMode="decimal"
                    value={montos[campo] ?? ""}
                    onChange={(e) => setMonto(campo, e.target.value)}
                    placeholder="Neto gravado"
                    className={smallInputClass}
                  />
                  <span className="text-right text-sm tabular-nums text-foreground/60">
                    {base.isZero() ? "—" : formatMoney(iva, currency as "ARS" | "USD")}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {OTROS_TRIBUTOS.map((tributo) => (
              <div key={tributo.name} className="space-y-1">
                <label className="text-xs text-foreground/70" htmlFor={tributo.name}>
                  {tributo.label}
                </label>
                <input
                  id={tributo.name}
                  name={tributo.name}
                  inputMode="decimal"
                  value={montos[tributo.name] ?? ""}
                  onChange={(e) => setMonto(tributo.name, e.target.value)}
                  className={smallInputClass}
                />
              </div>
            ))}
            <div className="space-y-1">
              <label className="text-xs text-foreground/70" htmlFor="retentionAmount">
                Retención
              </label>
              <input
                id="retentionAmount"
                name="retentionAmount"
                inputMode="decimal"
                value={retencion}
                onChange={(e) => setRetencion(e.target.value)}
                className={smallInputClass}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-baseline justify-between border-t border-foreground/10 pt-3">
        <span className="text-sm">Total</span>
        <span className="text-lg font-semibold tabular-nums">
          {formatMoney(totalVivo, currency as "ARS" | "USD")}
        </span>
      </div>

      <button type="submit" className={submitClass}>
        {editingDocumentId ? "Guardar cambios" : "Cargar gasto"}
      </button>
    </>
  );
}
