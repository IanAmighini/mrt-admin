"use client";

import { useMemo, useState } from "react";
import { formatProductBrandLabel } from "@/lib/product-label";

type ProductInfo = {
  id: string;
  name: string;
  oilType: string;
  presentation: string;
};

type Row = {
  key: number;
  marcaKey: string;
  productId: string;
  pallets: string;
};

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

function marcaKeyOf(p: { name: string; oilType: string }) {
  return `${p.name} ${p.oilType}`;
}

export function ProductionLinesFields({ products }: { products: ProductInfo[] }) {
  const [rows, setRows] = useState<Row[]>([{ key: 0, marcaKey: "", productId: "", pallets: "" }]);
  const [nextKey, setNextKey] = useState(1);

  const marcas = useMemo(() => {
    const seen = new Map<string, { key: string; label: string }>();
    for (const p of products) {
      const key = marcaKeyOf(p);
      if (!seen.has(key)) seen.set(key, { key, label: formatProductBrandLabel(p) });
    }
    return Array.from(seen.values());
  }, [products]);

  const productsByMarca = useMemo(() => {
    const map = new Map<string, ProductInfo[]>();
    for (const p of products) {
      const key = marcaKeyOf(p);
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [products]);

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const updated = { ...r, ...patch };
        if (patch.marcaKey !== undefined) {
          const options = productsByMarca.get(updated.marcaKey) ?? [];
          updated.productId = options[0]?.id ?? "";
        }
        return updated;
      })
    );
  }

  function addRow() {
    setRows((prev) => [...prev, { key: nextKey, marcaKey: "", productId: "", pallets: "" }]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  return (
    <div className="space-y-3">
      {rows.map((row, i) => {
        const formatoOptions = productsByMarca.get(row.marcaKey) ?? [];
        return (
          <div key={row.key} className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Item {i + 1}</p>
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="px-2 text-foreground/40 hover:text-foreground"
                  aria-label="Quitar ítem"
                >
                  ×
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-foreground/60">Marca *</label>
                <select
                  value={row.marcaKey}
                  onChange={(e) => updateRow(row.key, { marcaKey: e.target.value })}
                  className={inputClass}
                >
                  <option value="">— Seleccionar… —</option>
                  {marcas.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-foreground/60">Pallets *</label>
                <input
                  name="quantity"
                  value={row.pallets}
                  onChange={(e) => updateRow(row.key, { pallets: e.target.value })}
                  placeholder="0"
                  inputMode="decimal"
                  className={inputClass}
                />
                <p className="mt-0.5 text-xs text-foreground/40">Negativo = reformateo (desarma este formato)</p>
              </div>
            </div>
            <div>
              <label className="text-xs text-foreground/60">Formato *</label>
              <select
                value={row.productId}
                onChange={(e) => updateRow(row.key, { productId: e.target.value })}
                disabled={!row.marcaKey}
                className={inputClass}
              >
                <option value="">— Seleccionar… —</option>
                {formatoOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.presentation}
                  </option>
                ))}
              </select>
            </div>
            <input type="hidden" name="productId" value={row.productId} />
          </div>
        );
      })}
      <button
        type="button"
        onClick={addRow}
        className="w-full rounded-lg border border-dashed border-foreground/20 py-2 text-sm text-foreground/60 hover:bg-foreground/5"
      >
        + Agregar item
      </button>
    </div>
  );
}
