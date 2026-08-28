"use client";

import { useState } from "react";

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

/** Acepta "105x12x850", "105 X 12 X 850", etc. — cajas x botellas por caja x ml. */
const PRESENTATION_PATTERN = /^\s*(\d+)\s*x\s*(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*$/i;

const NEW_OPTION = "__new__";

type MarcaInfo = { id: string; name: string; oilType: string };
type FormatoInfo = { id: string; presentation: string };

export function NewProductFields({
  marcas,
  formatos,
}: {
  marcas: MarcaInfo[];
  formatos: FormatoInfo[];
}) {
  const [marcaId, setMarcaId] = useState("");
  const [formatoId, setFormatoId] = useState("");
  const [presentation, setPresentation] = useState("");
  const [boxesPerPallet, setBoxesPerPallet] = useState("");
  const [unitsPerBox, setUnitsPerBox] = useState("");
  const [bottleCapacityMl, setBottleCapacityMl] = useState("");

  const isNewMarca = marcaId === NEW_OPTION;
  const isNewFormato = formatoId === NEW_OPTION;

  function handlePresentationChange(value: string) {
    setPresentation(value);
    const match = value.match(PRESENTATION_PATTERN);
    if (match) {
      setBoxesPerPallet(match[1]);
      setUnitsPerBox(match[2]);
      setBottleCapacityMl(match[3].replace(",", "."));
    }
  }

  return (
    <>
      <div className="space-y-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
        <label className="text-sm font-medium" htmlFor="marcaId">
          Marca
        </label>
        <select
          id="marcaId"
          name="marcaId"
          required
          value={marcaId}
          onChange={(e) => setMarcaId(e.target.value)}
          className={inputClass}
        >
          <option value="">— Elegir marca —</option>
          {marcas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} {m.oilType}
            </option>
          ))}
          <option value={NEW_OPTION}>+ Marca nueva</option>
        </select>
        {isNewMarca && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="space-y-1">
              <label className="text-xs text-foreground/60" htmlFor="newMarcaName">
                Nombre
              </label>
              <input
                id="newMarcaName"
                name="newMarcaName"
                required
                placeholder="Bonanza"
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/60" htmlFor="newMarcaOilType">
                Tipo de aceite
              </label>
              <input
                id="newMarcaOilType"
                name="newMarcaOilType"
                required
                placeholder="Girasol"
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
        <label className="text-sm font-medium" htmlFor="formatoId">
          Formato
        </label>
        <select
          id="formatoId"
          name="formatoId"
          required
          value={formatoId}
          onChange={(e) => setFormatoId(e.target.value)}
          className={inputClass}
        >
          <option value="">— Elegir formato —</option>
          {formatos.map((f) => (
            <option key={f.id} value={f.id}>
              {f.presentation}
            </option>
          ))}
          <option value={NEW_OPTION}>+ Formato nuevo</option>
        </select>
        {isNewFormato && (
          <div className="space-y-2 pt-1">
            <div className="space-y-1">
              <label className="text-xs text-foreground/60" htmlFor="newPresentation">
                Presentación
              </label>
              <input
                id="newPresentation"
                name="newPresentation"
                required
                placeholder="105x12x850"
                value={presentation}
                onChange={(e) => handlePresentationChange(e.target.value)}
                className={inputClass}
              />
              <p className="text-xs text-foreground/40">
                Cajas x botellas por caja x ml — completa los 3 campos solos.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-foreground/60" htmlFor="newBoxesPerPallet">
                  Cajas por pallet
                </label>
                <input
                  id="newBoxesPerPallet"
                  name="newBoxesPerPallet"
                  inputMode="numeric"
                  placeholder="105"
                  value={boxesPerPallet}
                  onChange={(e) => setBoxesPerPallet(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-foreground/60" htmlFor="newUnitsPerBox">
                  Botellas por caja
                </label>
                <input
                  id="newUnitsPerBox"
                  name="newUnitsPerBox"
                  inputMode="numeric"
                  placeholder="12"
                  value={unitsPerBox}
                  onChange={(e) => setUnitsPerBox(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-foreground/60" htmlFor="newBottleCapacityMl">
                  Capacidad (ml)
                </label>
                <input
                  id="newBottleCapacityMl"
                  name="newBottleCapacityMl"
                  inputMode="decimal"
                  placeholder="850"
                  value={bottleCapacityMl}
                  onChange={(e) => setBottleCapacityMl(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <button
        type="submit"
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        Crear
      </button>
    </>
  );
}
