"use client";

import { useState } from "react";

type Circuit = "BLANCO" | "NEGRO";

type ItemInfo = {
  id: string;
  name: string;
  unit: string;
};

type Row = {
  key: number;
  itemId: string;
  quantity: string;
  unitPrice: string;
  /** Si la compra tiene cotización cargada, el servidor calcula el precio en pesos con esto. */
  unitPriceUsd: string;
  circuit: Circuit;
};

const filaVacia = (key: number): Row => ({
  key,
  itemId: "",
  quantity: "",
  unitPrice: "",
  unitPriceUsd: "",
  circuit: "BLANCO",
});

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-2 text-sm";
const selectClass = inputClass;

export function CompraLinesFields({ items }: { items: ItemInfo[] }) {
  const [rows, setRows] = useState<Row[]>([filaVacia(0)]);
  const [nextKey, setNextKey] = useState(1);

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, filaVacia(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const totals = rows.reduce(
    (acc, r) => {
      const subtotal = (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0);
      acc[r.circuit] += subtotal;
      acc.total += subtotal;
      return acc;
    },
    { BLANCO: 0, NEGRO: 0, total: 0 }
  );

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Líneas de la compra</p>
      {rows.map((row) => {
        const item = items.find((i) => i.id === row.itemId);
        const subtotal = (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0);

        return (
          <div
            key={row.key}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2"
          >
            <div className="min-w-0 flex-[2] basis-[200px]">
              <label className="text-xs text-foreground/60">Insumo</label>
              <select
                name="lineItemId"
                value={row.itemId}
                onChange={(e) => updateRow(row.key, { itemId: e.target.value })}
                className={selectClass}
              >
                <option value="">— Insumo —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 flex-1 basis-[120px]">
              <label className="text-xs text-foreground/60">Cantidad {item ? `(${item.unit})` : ""}</label>
              <input
                name="lineQuantity"
                value={row.quantity}
                onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                inputMode="decimal"
                className={inputClass}
              />
            </div>
            <div className="min-w-0 flex-1 basis-[120px]">
              <label className="text-xs text-foreground/60">Precio unit.</label>
              <input
                name="lineUnitPrice"
                value={row.unitPrice}
                onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                inputMode="decimal"
                className={inputClass}
              />
            </div>
            <div className="min-w-0 flex-1 basis-[110px]">
              <label className="text-xs text-foreground/60">Precio U$S</label>
              <input
                name="lineUnitPriceUsd"
                value={row.unitPriceUsd}
                onChange={(e) => updateRow(row.key, { unitPriceUsd: e.target.value })}
                inputMode="decimal"
                placeholder="opcional"
                className={inputClass}
              />
            </div>
            <div className="min-w-0 flex-1 basis-[160px]">
              <label className="text-xs text-foreground/60">Circuito</label>
              <select
                name="lineCircuit"
                value={row.circuit}
                onChange={(e) => updateRow(row.key, { circuit: e.target.value as Circuit })}
                className={selectClass}
              >
                <option value="BLANCO">Blanco (facturado)</option>
                <option value="NEGRO">Negro (sin facturar)</option>
              </select>
            </div>
            <div className="min-w-0 flex-1 basis-[120px]">
              <label className="text-xs text-foreground/60">Subtotal</label>
              <p className="px-2 py-2 text-sm">{subtotal.toFixed(2)}</p>
            </div>
            <div className="flex justify-end pb-2">
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="px-2 text-foreground/40 hover:text-foreground"
                  aria-label="Quitar línea"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        );
      })}
      <button type="button" onClick={addRow} className="text-sm underline underline-offset-2">
        + Agregar línea
      </button>
      <div className="flex gap-4 border-t border-foreground/10 pt-2 text-sm">
        <span>Total Blanco: {totals.BLANCO.toFixed(2)}</span>
        <span>Total Negro: {totals.NEGRO.toFixed(2)}</span>
        <span className="font-semibold">Total: {totals.total.toFixed(2)}</span>
      </div>
    </div>
  );
}
