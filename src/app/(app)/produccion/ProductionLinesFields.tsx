"use client";

import { useState } from "react";
import { formatProductBrandLabel } from "@/lib/product-label";

type MarcaInfo = { id: string; name: string; oilType: string };
type FormatoInfo = { id: string; presentation: string };
type ItemInfo = { id: string; name: string };

type Row = {
  key: number;
  marcaId: string;
  formatoId: string;
  pallets: string;
  /** Vacío = la que dice la receta. Se completa solo cuando se usó otra. */
  tapaUsadaItemId: string;
  cajaUsadaItemId: string;
};

const filaVacia = (key: number): Row => ({
  key,
  marcaId: "",
  formatoId: "",
  pallets: "",
  tapaUsadaItemId: "",
  cajaUsadaItemId: "",
});

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

export function ProductionLinesFields({
  marcas,
  formatos,
  tapas,
  cajas,
}: {
  marcas: MarcaInfo[];
  formatos: FormatoInfo[];
  tapas: ItemInfo[];
  cajas: ItemInfo[];
}) {
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

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
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
                name="marcaId"
                value={row.marcaId}
                onChange={(e) => updateRow(row.key, { marcaId: e.target.value })}
                className={inputClass}
              >
                <option value="">— Seleccionar… —</option>
                {marcas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatProductBrandLabel(m)}
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
              name="formatoId"
              value={row.formatoId}
              onChange={(e) => updateRow(row.key, { formatoId: e.target.value })}
              className={inputClass}
            >
              <option value="">— Seleccionar… —</option>
              {formatos.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.presentation}
                </option>
              ))}
            </select>
          </div>
          {/* Se completan solo si se usó algo distinto a la receta: las tres tapas de 29mm son
              intercambiables, y cuando se acaba la caja de la marca se usa la Lisa. Siempre se
              renderizan, aunque estén vacías, porque el servidor aparea las filas por posición. */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-foreground/60">Tapa usada</label>
              <select
                name="tapaUsadaItemId"
                value={row.tapaUsadaItemId}
                onChange={(e) => updateRow(row.key, { tapaUsadaItemId: e.target.value })}
                className={inputClass}
              >
                <option value="">— la de la receta —</option>
                {tapas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-foreground/60">Caja usada</label>
              <select
                name="cajaUsadaItemId"
                value={row.cajaUsadaItemId}
                onChange={(e) => updateRow(row.key, { cajaUsadaItemId: e.target.value })}
                className={inputClass}
              >
                <option value="">— la de la receta —</option>
                {cajas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ))}
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
