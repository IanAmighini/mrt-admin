"use client";

import { useState } from "react";
import type { Currency } from "@prisma/client";
import { formatProductLabel } from "@/lib/product-label";
import { formatMoney, parseNumeroSuave } from "@/lib/money";

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
  /** Pallets enteros. */
  quantity: string;
  /** Cajas sueltas. */
  cajas: string;
  pricePerBottle: string;
  circuit: Circuit;
};

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-2 text-sm";
const selectClass = inputClass;

export function RemitoLinesFields({
  products,
  priceMapByCircuit,
  defaultRows,
  moneda = "ARS",
  defaultCotizacion,
}: {
  products: ProductInfo[];
  priceMapByCircuit: Record<Circuit, Record<string, PriceInfo>>;
  defaultRows?: { productId: string; quantity: string; cajas?: string; pricePerBottle: string; circuit: Circuit }[];
  /** La moneda de la cuenta: en una en dólares, el precio ya es en dólares y no hay cotización. */
  moneda?: Currency;
  defaultCotizacion?: string;
}) {
  // La cotización vive acá y no en el encabezado porque es la que decide en qué moneda se escriben
  // los precios de las líneas: con ella cargada, van en dólares y los pesos salen solos.
  const [cotizacion, setCotizacion] = useState(defaultCotizacion ?? "");
  const cuentaEnDolares = moneda === "USD";
  const cotizacionNum = parseNumeroSuave(cotizacion)?.toNumber() ?? 0;
  // Con cotización, el precio se escribe en la otra moneda que la de la cuenta.
  const enDolares = !cuentaEnDolares && cotizacionNum > 0;
  const enPesos = cuentaEnDolares && cotizacionNum > 0;
  // Con `parseNumeroSuave` y no `Number()`: `Number("1350,50")` es NaN, y el precio se iba en cero.
  const num = (raw: string) => parseNumeroSuave(raw)?.toNumber() ?? 0;
  // El precio por botella en la moneda de la cuenta, que es en la que se guarda.
  const pesosPorBotella = (row: Row) =>
    enDolares
      ? num(row.pricePerBottle) * cotizacionNum
      : enPesos
        ? num(row.pricePerBottle) / cotizacionNum
        : num(row.pricePerBottle);
  const [rows, setRows] = useState<Row[]>(
    defaultRows && defaultRows.length > 0
      ? defaultRows.map((r, i) => ({ key: i, ...r, cajas: r.cajas ?? "" }))
      : [{ key: 0, productId: "", quantity: "", cajas: "", pricePerBottle: "", circuit: "BLANCO" }]
  );
  const [nextKey, setNextKey] = useState(rows.length);

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const updated = { ...r, ...patch };
        if (patch.productId !== undefined || patch.circuit !== undefined) {
          const price = priceMapByCircuit[updated.circuit]?.[updated.productId];
          if (price) updated.pricePerBottle = String(price.amount);
        }
        return updated;
      })
    );
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: nextKey, productId: "", quantity: "", cajas: "", pricePerBottle: "", circuit: "BLANCO" },
    ]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function botellasOf(row: Row): number {
    const product = products.find((p) => p.id === row.productId);
    const perPallet = (product?.boxesPerPallet ?? 0) * (product?.unitsPerBox ?? 0);
    return num(row.quantity) * perPallet + num(row.cajas) * (product?.unitsPerBox ?? 0);
  }

  const totals = rows.reduce(
    (acc, r) => {
      const subtotal = botellasOf(r) * pesosPorBotella(r);
      acc[r.circuit] += subtotal;
      acc.total += subtotal;
      return acc;
    },
    { BLANCO: 0, NEGRO: 0, total: 0 }
  );

  return (
    <div className="space-y-3">
      <div className="max-w-xs space-y-1">
        <label className="text-sm">
          {cuentaEnDolares ? "Cotización del dólar (si el precio es en pesos)" : "Cotización del dólar (si el precio es en U$S)"}
        </label>
        <input
          name="exchangeRate"
          value={cotizacion}
          onChange={(e) => setCotizacion(e.target.value)}
          inputMode="decimal"
          placeholder="1.523"
          className={inputClass}
        />
      </div>
      <p className="text-sm font-medium">Líneas del remito</p>
      {rows.map((row) => {
        const product = products.find((p) => p.id === row.productId);
        const botellas = botellasOf(row);
        const subtotal = botellas * pesosPorBotella(row);
        const perPallet = (product?.boxesPerPallet ?? 0) * (product?.unitsPerBox ?? 0);

        return (
          <div
            key={row.key}
            className="grid grid-cols-12 items-end gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2"
          >
            <div className="col-span-3 min-w-0">
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
            <div className="col-span-1 min-w-0">
              <label className="text-xs text-foreground/60">Pallets</label>
              <input
                name="lineQuantity"
                value={row.quantity}
                onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                inputMode="numeric"
                placeholder="0"
                className={inputClass}
              />
            </div>
            <div className="col-span-1 min-w-0">
              <label className="text-xs text-foreground/60">Cajas</label>
              <input
                name="lineCajas"
                value={row.cajas}
                onChange={(e) => updateRow(row.key, { cajas: e.target.value })}
                inputMode="numeric"
                placeholder="0"
                className={inputClass}
              />
              {botellas > 0 && <p className="text-xs text-foreground/40">{botellas} botellas</p>}
            </div>
            <div className="col-span-2 min-w-0">
              <label className="text-xs text-foreground/60">
                {enPesos ? "$/bot." : enDolares || cuentaEnDolares ? "U$S/bot." : "Precio/bot."}
              </label>
              <input
                value={row.pricePerBottle}
                onChange={(e) => updateRow(row.key, { pricePerBottle: e.target.value })}
                inputMode="decimal"
                className={inputClass}
              />
              {(enDolares || enPesos) && num(row.pricePerBottle) > 0 && (
                <p className="text-xs text-foreground/40 tabular-nums">
                  = {formatMoney(pesosPorBotella(row), moneda)}/bot.
                  {perPallet > 0 && ` · ${formatMoney(pesosPorBotella(row) * perPallet, moneda)}/pallet`}
                </p>
              )}
            </div>
            <div className="col-span-2 min-w-0">
              <label className="text-xs text-foreground/60">Circuito</label>
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
            <div className="col-span-2 min-w-0">
              <label className="text-xs text-foreground/60">Subtotal</label>
              <p className="px-2 py-2 text-sm tabular-nums">{formatMoney(subtotal, moneda)}</p>
            </div>
            <div className="col-span-1 min-w-0">
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
            {/* El precio va tal como se escribió; el del pallet lo calcula el servidor. Los dos
                campos van siempre, uno vacío, porque se aparean por posición. */}
            <input type="hidden" name="linePrecioBotella" value={enDolares ? "" : row.pricePerBottle} />
            <input type="hidden" name="linePrecioBotellaUsd" value={enDolares ? row.pricePerBottle : ""} />
          </div>
        );
      })}
      <button type="button" onClick={addRow} className="text-sm underline underline-offset-2">
        + Agregar línea
      </button>
      <div className="flex gap-4 border-t border-foreground/10 pt-2 text-sm">
        <span>Total Blanco: {formatMoney(totals.BLANCO, moneda)}</span>
        <span>Total Negro: {formatMoney(totals.NEGRO, moneda)}</span>
        <span className="font-semibold">Total: {formatMoney(totals.total, moneda)}</span>
      </div>
    </div>
  );
}
