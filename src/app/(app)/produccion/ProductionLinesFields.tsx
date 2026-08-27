"use client";

import { useState } from "react";
import { formatProductLabel } from "@/lib/product-label";

const selectClass = "flex-1 rounded border border-black/20 px-3 py-2 text-sm";
const quantityClass = "w-32 rounded border border-black/20 px-3 py-2 text-sm";

export function ProductionLinesFields({
  products,
}: {
  products: { id: string; name: string; oilType: string; bottleCapacityMl: number | null }[];
}) {
  const [rowKeys, setRowKeys] = useState([0]);
  const [nextKey, setNextKey] = useState(1);

  return (
    <div className="space-y-2">
      {rowKeys.map((key) => (
        <div key={key} className="flex items-center gap-2">
          <select name="productId" defaultValue="" className={selectClass}>
            <option value="">— Producto —</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {formatProductLabel(product)}
              </option>
            ))}
          </select>
          <input name="quantity" placeholder="Cantidad" inputMode="decimal" className={quantityClass} />
          {rowKeys.length > 1 && (
            <button
              type="button"
              onClick={() => setRowKeys(rowKeys.filter((k) => k !== key))}
              className="px-2 text-black/40 hover:text-black"
              aria-label="Quitar fila"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setRowKeys([...rowKeys, nextKey]);
          setNextKey(nextKey + 1);
        }}
        className="text-sm underline underline-offset-2"
      >
        + Agregar producto
      </button>
    </div>
  );
}
