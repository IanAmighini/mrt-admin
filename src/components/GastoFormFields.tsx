"use client";

import { useState } from "react";
import type { Currency } from "@prisma/client";
import { MonedaEscritaFields } from "./MonedaEscritaFields";
import { ViajeFields, type ViajeOption } from "./ViajeFields";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_ORDER } from "@/lib/labels";
import { computeGastoTotals, filasDesdeValores } from "@/lib/impuestos";
import { ImpuestosFields } from "./ImpuestosFields";
import { formatMoney, parseNumeroSuave, ZERO } from "@/lib/money";
import { SelectBuscable } from "@/components/ui/SelectBuscable";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

export type GastoDefaults = {
  entityId?: string;
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
  entregaId?: string | null;
};

export function GastoFormFields({
  entityId,
  proveedores,
  editingDocumentId,
  defaultValues,
  viajes,
  rotuloSubcuenta,
  subcuentasPorProveedor,
  monedaCuenta = "ARS",
}: {
  /** Si viene, el proveedor queda fijo (se abre desde su ficha). */
  entityId?: string;
  /** La moneda de la cuenta del proveedor fijo. Con selector, sale del proveedor elegido. */
  monedaCuenta?: Currency;
  /** Si no hay proveedor fijo, la lista para elegirlo — se abre desde Compras. Cada uno trae su
   * rubro, para precargarlo al elegirlo. */
  proveedores?: { id: string; name: string; expenseCategory: string | null; moneda?: Currency }[];
  /** Si viene, el formulario edita ese gasto en vez de crear uno nuevo. */
  editingDocumentId?: string;
  defaultValues?: GastoDefaults;
  /** Las partes en que se divide la cuenta de este proveedor, si la divide: el alquiler y los
   * gastos comunes de Goloeste. Vacío en los demás y ahí el selector no aparece. */
  viajes?: ViajeOption[];
  rotuloSubcuenta?: string;
  /** Desde Compras, donde el proveedor se elige en el formulario: las subcuentas de los que las
   * tienen, para mostrar el selector cuando se elige uno de ésos. */
  subcuentasPorProveedor?: Record<string, { viajes: ViajeOption[]; rotulo: string }>;
}) {
  const [proveedorElegido, setProveedorElegido] = useState(defaultValues?.entityId ?? "");
  const subcuentas = viajes ?? subcuentasPorProveedor?.[proveedorElegido]?.viajes;
  const rotulo = rotuloSubcuenta ?? subcuentasPorProveedor?.[proveedorElegido]?.rotulo;
  const [circuit, setCircuit] = useState<"BLANCO" | "NEGRO">(defaultValues?.circuit ?? "BLANCO");
  // La moneda de la cuenta: la del proveedor fijo, o la del que se elija en el selector.
  const [monedaDeLaCuenta, setMonedaDeLaCuenta] = useState<Currency>(
    proveedores?.find((p) => p.id === defaultValues?.entityId)?.moneda ?? monedaCuenta
  );
  // En qué se escriben los montos: arranca en la de la cuenta (al editar, en la del gasto, que es ésa).
  const [currency, setCurrency] = useState<Currency>(
    (defaultValues?.currency as Currency | undefined) ?? monedaDeLaCuenta
  );
  const [montos, setMontos] = useState<Record<string, string>>(defaultValues?.tributos ?? {});
  const [montoNegro, setMontoNegro] = useState(defaultValues?.amount ?? "");
  // El rubro arranca con el del proveedor: a Edenor se le cargan servicios, al transportista flete.
  // Se puede cambiar, y una vez tocado deja de seguir al proveedor.
  const [rubro, setRubro] = useState(defaultValues?.expenseCategory ?? "");
  const [rubroTocado, setRubroTocado] = useState(false);

  const totals =
    circuit === "NEGRO"
      ? null
      : computeGastoTotals(filasDesdeValores(montos), parseNumeroSuave(montos.retentionAmount ?? "") ?? ZERO);
  const totalVivo =
    circuit === "NEGRO" ? (parseNumeroSuave(montoNegro) ?? ZERO) : totals!.totalAmount;

  return (
    <>
      {entityId && <input type="hidden" name="entityId" value={entityId} />}
      {editingDocumentId && <input type="hidden" name="documentId" value={editingDocumentId} />}

      {!entityId && (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="entityId">
            Proveedor
          </label>
          <SelectBuscable
            id="entityId"
            name="entityId"
            required
            defaultValue={defaultValues?.entityId ?? ""}
            opciones={(proveedores ?? []).map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Escribí el proveedor…"
            onChange={(proveedorId) => {
              setProveedorElegido(proveedorId);
              const elegido = (proveedores ?? []).find((p) => p.id === proveedorId);
              // Cambiar de proveedor cambia la moneda de la cuenta; los montos se vuelven a escribir en ésa.
              setMonedaDeLaCuenta(elegido?.moneda ?? "ARS");
              setCurrency(elegido?.moneda ?? "ARS");
              if (rubroTocado) return;
              setRubro(elegido?.expenseCategory ?? "");
            }}
            className={inputClass}
          />
        </div>
      )}

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
            Cuenta 1 (c/factura)
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
            Cuenta 2 (s/factura)
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
            value={rubro}
            onChange={(e) => {
              setRubro(e.target.value);
              setRubroTocado(true);
            }}
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
        <MonedaEscritaFields
          monedaCuenta={monedaDeLaCuenta}
          value={currency}
          onChange={setCurrency}
          defaultCotizacion={defaultValues?.exchangeRate}
          className={inputClass}
        />
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
        <ImpuestosFields
          defaults={defaultValues?.tributos}
          onChange={setMontos}
          aclaracion="Cargá el neto gravado de cada alícuota que traiga la factura. La mayoría trae una sola."
        />
      )}

      <div className="flex items-baseline justify-between border-t border-foreground/10 pt-3">
        <span className="text-sm">Total</span>
        <span className="text-lg font-semibold tabular-nums">
          {formatMoney(totalVivo, currency)}
        </span>
      </div>

      <ViajeFields
        key={proveedorElegido}
        viajes={subcuentas}
        mostrarDestinatario={false}
        rotulo={rotulo}
        defaultViajeId={defaultValues?.entregaId}
      />

      <button type="submit" className={submitClass}>
        {editingDocumentId ? "Guardar cambios" : "Cargar gasto"}
      </button>
    </>
  );
}
