"use client";

import { useState } from "react";
import { formatProductBrandLabel } from "@/lib/product-label";

type MarcaInfo = { id: string; name: string; oilType: string };
type FormatoInfo = { id: string; presentation: string };

type Row = {
  key: number;
  marcaId: string;
  formatoId: string;
  accion: "ARMADO" | "DESARMADO";
  pallets: string;
};

export type FilaDeArmado = Omit<Row, "key">;

const filaVacia = (key: number): Row => ({ key, marcaId: "", formatoId: "", accion: "ARMADO", pallets: "" });

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

/**
 * Pallets que se arman con cajas sueltas que ya estaban, o que se desarman en cajas sueltas.
 *
 * Es lo que antes se cargaba como producción con pallets negativos. Va aparte porque no es
 * producir: las botellas ya estaban envasadas, así que no mueve aceite, envases ni etiquetas —
 * sólo pasa cajas de sueltas a pallet o al revés. Desarmar uno de 105 para armar uno de 84 son dos
 * filas: se desarma el de 105 y se arma el de 84, y las 21 cajas que sobran quedan sueltas.
 *
 * Arranca sin filas: casi ninguna carga tiene armado, y una fila vacía obligaría a mirarla.
 */
export function ArmadoLinesFields({
  marcas,
  formatos,
  defaultRows,
}: {
  marcas: MarcaInfo[];
  formatos: FormatoInfo[];
  defaultRows?: FilaDeArmado[];
}) {
  const [rows, setRows] = useState<Row[]>(() => (defaultRows ?? []).map((f, i) => ({ ...filaVacia(i), ...f })));
  const [nextKey, setNextKey] = useState(() => Math.max(1, defaultRows?.length ?? 0));

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">Armado y desarmado de pallets</p>
        <p className="text-xs text-foreground/50">
          Con cajas que ya estaban hechas. No descuenta insumos: sólo pasa cajas de sueltas a pallet, o
          al revés.
        </p>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[1fr_1fr_auto_5rem_auto] items-end gap-2">
          <div>
            <label className="text-xs text-foreground/60">Marca</label>
            <select
              name="armadoMarcaId"
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
          <div>
            <label className="text-xs text-foreground/60">Formato</label>
            <select
              name="armadoFormatoId"
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
          <div>
            <label className="text-xs text-foreground/60">Qué</label>
            <select
              name="armadoAccion"
              value={row.accion}
              onChange={(e) => updateRow(row.key, { accion: e.target.value as Row["accion"] })}
              className={inputClass}
            >
              <option value="ARMADO">Se armó</option>
              <option value="DESARMADO">Se desarmó</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-foreground/60">Pallets</label>
            <input
              name="armadoPallets"
              value={row.pallets}
              onChange={(e) => updateRow(row.key, { pallets: e.target.value })}
              inputMode="numeric"
              placeholder="1"
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
            className="px-2 pb-2 text-foreground/40 hover:text-foreground"
            aria-label="Quitar"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setRows((prev) => [...prev, filaVacia(nextKey)]);
          setNextKey((k) => k + 1);
        }}
        className="w-full rounded-lg border border-dashed border-foreground/20 py-2 text-sm text-foreground/60 hover:bg-foreground/5"
      >
        + Armado o desarmado
      </button>
    </div>
  );
}
