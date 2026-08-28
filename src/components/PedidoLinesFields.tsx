"use client";

import { useState } from "react";
import { formatProductLabel } from "@/lib/product-label";

type ProductInfo = {
  id: string;
  name: string;
  oilType: string;
  bottleCapacityMl: number | null;
};

type Row = {
  key: number;
  productId: string;
  pallets: string;
};

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-2 text-sm";
const selectClass = inputClass;

export function PedidoLinesFields({
  products,
  defaultRows,
}: {
  products: ProductInfo[];
  defaultRows?: { productId: string; pallets: string }[];
}) {
  const [rows, setRows] = useState<Row[]>(
    defaultRows && defaultRows.length > 0
      ? defaultRows.map((r, i) => ({ key: i, ...r }))
      : [{ key: 0, productId: "", pallets: "" }]
  );
  const [nextKey, setNextKey] = useState(rows.length);

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { key: nextKey, productId: "", pallets: "" }]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Líneas del pedido</p>
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2">
          <div className="col-span-8">
            <label className="text-xs text-foreground/60">Producto</label>
            <select
              name="lineProductId"
              value={row.productId}
              onChange={(e) => updateRow(row.key, { productId: e.target.value })}
              className={selectClass}
            >
              <option value="">— Producto —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatProductLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <label className="text-xs text-foreground/60">Pallets</label>
            <input
              name="linePallets"
              value={row.pallets}
              onChange={(e) => updateRow(row.key, { pallets: e.target.value })}
              inputMode="decimal"
              className={inputClass}
            />
          </div>
          <div className="col-span-1">
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
      ))}
      <button type="button" onClick={addRow} className="text-sm underline underline-offset-2">
        + Agregar línea
      </button>
    </div>
  );
}
