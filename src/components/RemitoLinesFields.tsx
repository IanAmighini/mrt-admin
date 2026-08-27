"use client";

import { useState } from "react";
import { formatProductLabel } from "@/lib/product-label";

type Circuit = "BLANCO" | "NEGRO";

type ProductInfo = {
  id: string;
  name: string;
  oilType: string;
  bottleCapacityMl: number | null;
  boxesPerPallet: number | null;
  unitsPerBox: number | null;
};

type PriceInfo = { amount: number; currency: string };

type Row = {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
  circuit: Circuit;
};

const inputClass = "w-full rounded border border-black/20 px-2 py-2 text-sm";
const selectClass = inputClass;

export function RemitoLinesFields({
  products,
  priceMapByCircuit,
}: {
  products: ProductInfo[];
  priceMapByCircuit: Record<Circuit, Record<string, PriceInfo>>;
}) {
  const [rows, setRows] = useState<Row[]>([
    { key: 0, productId: "", quantity: "", unitPrice: "", circuit: "BLANCO" },
  ]);
  const [nextKey, setNextKey] = useState(1);

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const updated = { ...r, ...patch };
        if (patch.productId !== undefined || patch.circuit !== undefined) {
          const price = priceMapByCircuit[updated.circuit]?.[updated.productId];
          if (price) updated.unitPrice = String(price.amount);
        }
        return updated;
      })
    );
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: nextKey, productId: "", quantity: "", unitPrice: "", circuit: "BLANCO" },
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
      <p className="text-sm font-medium">Líneas del remito</p>
      {rows.map((row) => {
        const product = products.find((p) => p.id === row.productId);
        const subtotal = (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0);
        const equivUnits =
          product?.boxesPerPallet && product?.unitsPerBox && row.quantity
            ? Number(row.quantity) * product.boxesPerPallet * product.unitsPerBox
            : null;

        return (
          <div
            key={row.key}
            className="grid grid-cols-12 items-end gap-2 rounded border border-black/10 p-2"
          >
            <div className="col-span-3">
              <label className="text-xs text-black/60">Producto</label>
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
            <div className="col-span-2">
              <label className="text-xs text-black/60">Cantidad</label>
              <input
                name="lineQuantity"
                value={row.quantity}
                onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                inputMode="decimal"
                className={inputClass}
              />
              {equivUnits !== null && (
                <p className="text-xs text-black/40">{equivUnits} unidades</p>
              )}
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
