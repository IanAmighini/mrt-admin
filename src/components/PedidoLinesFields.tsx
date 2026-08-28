"use client";

import { useState } from "react";
import { formatProductBrandLabel } from "@/lib/product-label";

type MarcaInfo = { id: string; name: string; oilType: string };
type FormatoInfo = { id: string; presentation: string };

type Row = {
  key: number;
  marcaId: string;
  formatoId: string;
  pallets: string;
};

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-2 text-sm";

export function PedidoLinesFields({
  marcas,
  formatos,
}: {
  marcas: MarcaInfo[];
  formatos: FormatoInfo[];
}) {
  const [rows, setRows] = useState<Row[]>([{ key: 0, marcaId: "", formatoId: "", pallets: "" }]);
  const [nextKey, setNextKey] = useState(1);

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { key: nextKey, marcaId: "", formatoId: "", pallets: "" }]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Líneas del pedido</p>
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-12 items-end gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2"
        >
          <div className="col-span-5">
            <label className="text-xs text-foreground/60">Marca</label>
            <select
              name="lineMarcaId"
              value={row.marcaId}
              onChange={(e) => updateRow(row.key, { marcaId: e.target.value })}
              className={inputClass}
            >
              <option value="">— Marca —</option>
              {marcas.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatProductBrandLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-4">
            <label className="text-xs text-foreground/60">Formato</label>
            <select
              name="lineFormatoId"
              value={row.formatoId}
              onChange={(e) => updateRow(row.key, { formatoId: e.target.value })}
              className={inputClass}
            >
              <option value="">— Formato —</option>
              {formatos.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.presentation}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
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
