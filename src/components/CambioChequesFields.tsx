"use client";

import { useState } from "react";
import type { Entity } from "@prisma/client";
import { formatMoney, parseNumeroSuave, ZERO } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

type Fila = { key: number; numero: string; banco: string; monto: string; fecha: string };
const filaVacia = (key: number): Fila => ({ key, numero: "", banco: "", monto: "", fecha: "" });

/**
 * Le damos efectivo a otra empresa y nos da cheques. Es a la par: lo que sale de la caja es el
 * total de los cheques, así que no hay un campo de efectivo — se calcula y se muestra.
 */
export function CambioChequesFields({ treasuries }: { treasuries: Entity[] }) {
  const [filas, setFilas] = useState<Fila[]>([filaVacia(0)]);
  const [nextKey, setNextKey] = useState(1);

  const set = (key: number, campo: keyof Fila, valor: string) =>
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, [campo]: valor } : f)));

  const total = filas.reduce((acc, f) => acc.plus(parseNumeroSuave(f.monto) ?? ZERO), ZERO);

  return (
    <>
      <p className="text-xs text-foreground/50">
        El efectivo que sale de la caja es el total de los cheques que entran. Los cheques quedan en
        cartera, listos para entregarle a un proveedor.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="cambiadoA">
            Se lo cambiamos a
          </label>
          <input id="cambiadoA" name="cambiadoA" placeholder="Nombre de la empresa" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required className={inputClass} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="treasuryId">
          De qué caja sale el efectivo
        </label>
        <select id="treasuryId" name="treasuryId" required className={inputClass}>
          {treasuries.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <p className="text-sm">Cuenta</p>
        <div className="grid grid-cols-2 gap-2">
          <label className={toggleClass}>
            <input type="radio" name="circuit" value="NEGRO" defaultChecked className="sr-only" />
            Negro
          </label>
          <label className={toggleClass}>
            <input type="radio" name="circuit" value="BLANCO" className="sr-only" />
            Blanco
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm">Cheques que entran</p>
        {filas.map((f) => (
          <div key={f.key} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-foreground/60">Número</label>
              <input
                name="chequeNumero"
                value={f.numero}
                onChange={(e) => set(f.key, "numero", e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/60">Banco</label>
              <input
                name="chequeBanco"
                value={f.banco}
                onChange={(e) => set(f.key, "banco", e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/60">Monto</label>
              <input
                name="chequeMonto"
                inputMode="decimal"
                value={f.monto}
                onChange={(e) => set(f.key, "monto", e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/60">Cobrable desde</label>
              <input
                name="chequeFecha"
                type="date"
                value={f.fecha}
                onChange={(e) => set(f.key, "fecha", e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="pb-1">
              {filas.length > 1 && (
                <button
                  type="button"
                  onClick={() => setFilas((prev) => prev.filter((x) => x.key !== f.key))}
                  className="px-2 text-foreground/40 hover:text-foreground"
                  aria-label="Quitar cheque"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setFilas((prev) => [...prev, filaVacia(nextKey)]);
            setNextKey((k) => k + 1);
          }}
          className="rounded-lg border border-foreground/20 bg-background px-3 py-1.5 text-sm hover:bg-foreground/5"
        >
          + Agregar cheque
        </button>
      </div>

      <div className="flex items-baseline justify-between border-t border-foreground/10 pt-3">
        <span className="text-sm">Efectivo que sale de la caja</span>
        <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
      </div>

      <button type="submit" className={submitClass}>
        Registrar cambio
      </button>
    </>
  );
}
