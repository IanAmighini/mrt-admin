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
  circuit: Circuit;
};

const inputClass = "w-full rounded border border-black/20 px-2 py-2 text-sm";
const selectClass = inputClass;

export function CompraLinesFields({ items }: { items: ItemInfo[] }) {
  const [rows, setRows] = useState<Row[]>([
    { key: 0, itemId: "", quantity: "", unitPrice: "", circuit: "BLANCO" },
  ]);
  const [nextKey, setNextKey] = useState(1);

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: nextKey, itemId: "", quantity: "", unitPrice: "", circuit: "BLANCO" },
    ]);
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
            className="grid grid-cols-12 items-end gap-2 rounded border border-black/10 p-2"
          >
            <div className="col-span-3">
              <label className="text-xs text-black/60">Insumo</label>
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
            <div className="col-span-2">
              <label className="text-xs text-black/60">Cantidad {item ? `(${item.unit})` : ""}</label>
              <input
                name="lineQuantity"
                value={row.quantity}
                onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                inputMode="decimal"
                className={inputClass}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-black/60">Precio unit.</label>
              <input
                name="lineUnitPrice"
                value={row.unitPrice}
                onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                inputMode="decimal"
                className={inputClass}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-black/60">Circuito</label>
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
            <div className="col-span-2">
              <label className="text-xs text-black/60">Subtotal</label>
              <p className="px-2 py-2 text-sm">{subtotal.toFixed(2)}</p>
            </div>
            <div className="col-span-1">
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="px-2 text-black/40 hover:text-black"
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
      <div className="flex gap-4 border-t border-black/10 pt-2 text-sm">
        <span>Total Blanco: {totals.BLANCO.toFixed(2)}</span>
        <span>Total Negro: {totals.NEGRO.toFixed(2)}</span>
        <span className="font-semibold">Total: {totals.total.toFixed(2)}</span>
      </div>
    </div>
  );
}
