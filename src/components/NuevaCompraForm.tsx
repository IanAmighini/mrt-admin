"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

type Circuit = "BLANCO" | "NEGRO";

type ProveedorInfo = { id: string; name: string };
type ItemInfo = { id: string; name: string; unit: string };

type Row = {
  key: number;
  itemId: string;
  quantity: string;
  unitPrice: string;
  circuit: Circuit;
};

export function NuevaCompraForm({
  action,
  proveedores,
  items,
}: {
  action: (formData: FormData) => void | Promise<void>;
  proveedores: ProveedorInfo[];
  items: ItemInfo[];
}) {
  const [rows, setRows] = useState<Row[]>([
    { key: 0, itemId: "", quantity: "", unitPrice: "", circuit: "BLANCO" },
  ]);
  const [nextKey, setNextKey] = useState(1);

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { key: nextKey, itemId: "", quantity: "", unitPrice: "", circuit: "BLANCO" }]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const computedRows = rows.map((row) => {
    const item = items.find((i) => i.id === row.itemId);
    const subtotal = (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0);
    return { row, item, subtotal };
  });

  const totals = computedRows.reduce(
    (acc, r) => {
      acc[r.row.circuit] += r.subtotal;
      acc.total += r.subtotal;
      return acc;
    },
    { BLANCO: 0, NEGRO: 0, total: 0 }
  );

  return (
    <form action={action} className="space-y-6">
      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Información general</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="entityId">
              Proveedor *
            </label>
            <select id="entityId" name="entityId" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                — Elegir proveedor —
              </option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="number">
              Número *
            </label>
            <input id="number" name="number" required placeholder="Ej: 991" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="date">
              Fecha *
            </label>
            <input id="date" type="date" name="date" required className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="dueDate">
              Vencimiento (opcional)
            </label>
            <input id="dueDate" type="date" name="dueDate" className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="currency">
              Moneda
            </label>
            <select id="currency" name="currency" defaultValue="ARS" className={inputClass}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="exchangeRate">
              Cotización (si es USD)
            </label>
            <input id="exchangeRate" name="exchangeRate" className={inputClass} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Líneas de la compra</h2>
          <button type="button" onClick={addRow} className={secondaryButtonClass}>
            + Agregar línea
          </button>
        </div>

        <div className="space-y-3">
          {computedRows.map(({ row, item, subtotal }) => (
            <div
              key={row.key}
              className="grid grid-cols-12 items-end gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2"
            >
              <div className="col-span-3 min-w-0">
                <label className="text-xs text-foreground/60">Insumo</label>
                <select
                  value={row.itemId}
                  onChange={(e) => updateRow(row.key, { itemId: e.target.value })}
                  className={inputClass}
                >
                  <option value="">— Insumo —</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 min-w-0">
                <label className="text-xs text-foreground/60">Cantidad {item ? `(${item.unit})` : ""}</label>
                <input
                  value={row.quantity}
                  onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                  inputMode="decimal"
                  className={inputClass}
                />
              </div>
              <div className="col-span-2 min-w-0">
                <label className="text-xs text-foreground/60">Precio unit.</label>
                <input
                  value={row.unitPrice}
                  onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                  inputMode="decimal"
                  className={inputClass}
                />
              </div>
              <div className="col-span-2 min-w-0">
                <label className="text-xs text-foreground/60">Circuito</label>
                <select
                  value={row.circuit}
                  onChange={(e) => updateRow(row.key, { circuit: e.target.value as Circuit })}
                  className={inputClass}
                >
                  <option value="BLANCO">Blanco (facturado)</option>
                  <option value="NEGRO">Negro (sin facturar)</option>
                </select>
              </div>
              <div className="col-span-2 min-w-0">
                <label className="text-xs text-foreground/60">Subtotal</label>
                <p className="px-2 py-2 text-sm">{formatMoney(subtotal)}</p>
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

              <input type="hidden" name="lineItemId" value={row.itemId} />
              <input type="hidden" name="lineQuantity" value={row.quantity} />
              <input type="hidden" name="lineUnitPrice" value={row.unitPrice} />
              <input type="hidden" name="lineCircuit" value={row.circuit} />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-end gap-6 border-t border-foreground/10 pt-3 text-sm">
          <div className="text-right">
            <p className="text-xs text-foreground/50">Total Blanco</p>
            <p className="font-semibold">{formatMoney(totals.BLANCO)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">Total Negro</p>
            <p className="font-semibold">{formatMoney(totals.NEGRO)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">Total</p>
            <p className="text-lg font-bold">{formatMoney(totals.total)}</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
        >
          Crear compra
        </button>
      </div>
    </form>
  );
}

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const secondaryButtonClass = "rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-1.5 text-sm hover:bg-foreground/5";
