"use client";

import { useState } from "react";

const inputClass = "w-full rounded border border-black/20 px-3 py-2 text-sm";

/** Acepta "105x12x850", "105 X 12 X 850", etc. — cajas x botellas por caja x ml. */
const PRESENTATION_PATTERN = /^\s*(\d+)\s*x\s*(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*$/i;

export function NewProductFields() {
  const [presentation, setPresentation] = useState("");
  const [boxesPerPallet, setBoxesPerPallet] = useState("");
  const [unitsPerBox, setUnitsPerBox] = useState("");
  const [bottleCapacityMl, setBottleCapacityMl] = useState("");

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
      <div className="space-y-1 col-span-2">
        <label className="text-sm" htmlFor="name">
          Marca
        </label>
        <input id="name" name="name" required placeholder="Bonanza" className={inputClass} />
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="oilType">
          Tipo de aceite
        </label>
        <input id="oilType" name="oilType" required placeholder="Girasol" className={inputClass} />
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="presentation">
          Presentación
        </label>
        <input
          id="presentation"
          name="presentation"
          required
          placeholder="105x12x850"
          value={presentation}
          onChange={(e) => handlePresentationChange(e.target.value)}
          className={inputClass}
        />
        <p className="text-xs text-black/40">Cajas x botellas por caja x ml — completa los 3 campos solos.</p>
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="boxesPerPallet">
          Cajas por pallet
        </label>
        <input
          id="boxesPerPallet"
          name="boxesPerPallet"
          inputMode="numeric"
          placeholder="105"
          value={boxesPerPallet}
          onChange={(e) => setBoxesPerPallet(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="unitsPerBox">
          Botellas por caja
        </label>
        <input
          id="unitsPerBox"
          name="unitsPerBox"
          inputMode="numeric"
          placeholder="12"
          value={unitsPerBox}
          onChange={(e) => setUnitsPerBox(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="bottleCapacityMl">
          Capacidad de botella (ml)
        </label>
        <input
          id="bottleCapacityMl"
          name="bottleCapacityMl"
          inputMode="decimal"
          placeholder="850"
          value={bottleCapacityMl}
          onChange={(e) => setBottleCapacityMl(e.target.value)}
          className={inputClass}
        />
      </div>
    </>
  );
}
