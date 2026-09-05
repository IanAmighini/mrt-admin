"use client";

import { useMemo, useState } from "react";
import type { SupplierCategory } from "@prisma/client";
import { formatMoney, formatNumeroEditable, formatQuantity, parseNumeroSuave } from "@/lib/money";
import { SUPPLIER_CATEGORY_LABELS, SUPPLIER_CATEGORY_ORDER } from "@/lib/labels";

type Circuit = "BLANCO" | "NEGRO";

type ProveedorInfo = { id: string; name: string };
type ItemInfo = {
  id: string;
  name: string;
  unit: string;
  category: SupplierCategory;
  /** Envases: unidades del pallet descartable con el que los entrega el proveedor. */
  unitsPerPallet: number | null;
  /** Último precio pactado en U$S por unidad, si lo hay. */
  precioSopladoUsd: string | null;
};

type Row = {
  key: number;
  /** Solo filtra el desplegable de insumo; no se manda al servidor. */
  category: SupplierCategory | "";
  itemId: string;
  /** Solo para insumos que vienen por pallet: calcula la cantidad; no se manda al servidor. */
  pallets: string;
  quantity: string;
  unitPrice: string;
  unitPriceUsd: string;
  circuit: Circuit;
};

const filaVacia = (key: number): Row => ({
  key,
  category: "",
  itemId: "",
  pallets: "",
  quantity: "",
  unitPrice: "",
  unitPriceUsd: "",
  circuit: "BLANCO",
});

export function NuevaCompraForm({
  action,
  proveedores,
  items,
  fixedEntity,
}: {
  action: (formData: FormData) => void | Promise<void>;
  proveedores: ProveedorInfo[];
  items: ItemInfo[];
  /** Si se llega desde la ficha de un proveedor puntual, fija el proveedor y oculta el selector. */
  fixedEntity?: ProveedorInfo;
}) {
  const [rows, setRows] = useState<Row[]>([filaVacia(0)]);
  const [nextKey, setNextKey] = useState(1);
  // La cotización deja de ser un dato suelto del encabezado: con ella cargada, las líneas piden el
  // precio en U$S y el de pesos pasa a ser derivado.
  const [cotizacion, setCotizacion] = useState("");
  const cotizacionNum = parseNumeroSuave(cotizacion);
  const enDolares = cotizacionNum !== null && cotizacionNum.greaterThan(0);

  const itemsPorCategoria = useMemo(() => {
    const m = new Map<SupplierCategory, ItemInfo[]>();
    for (const i of items) {
      const list = m.get(i.category) ?? [];
      list.push(i);
      m.set(i.category, list);
    }
    return m;
  }, [items]);

  // Solo las categorías que tienen algo cargado: ofrecer "Cinta" cuando no hay ninguna cinta manda
  // al usuario a un desplegable vacío.
  const categorias = useMemo(
    () => SUPPLIER_CATEGORY_ORDER.filter((c) => itemsPorCategoria.has(c)),
    [itemsPorCategoria]
  );

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Cambiar el tipo invalida el insumo elegido. Si la categoría tiene uno solo, se elige solo. */
  function changeCategory(key: number, category: SupplierCategory | "") {
    const enCategoria = category ? itemsPorCategoria.get(category) ?? [] : [];
    changeItem(key, enCategoria.length === 1 ? enCategoria[0].id : "", { category });
  }

  /** Elegir el insumo trae su último precio pactado en U$S y limpia lo que era del insumo anterior. */
  function changeItem(key: number, itemId: string, extra: Partial<Row> = {}) {
    const item = items.find((i) => i.id === itemId);
    updateRow(key, {
      ...extra,
      itemId,
      pallets: "",
      quantity: "",
      unitPriceUsd: item?.precioSopladoUsd ? formatNumeroEditable(item.precioSopladoUsd, 4) : "",
    });
  }

  /** Los pallets son un atajo para escribir la cantidad, no un dato aparte: llenan las unidades. */
  function changePallets(key: number, pallets: string, unitsPerPallet: number | null) {
    const n = parseNumeroSuave(pallets);
    updateRow(key, {
      pallets,
      quantity: n && unitsPerPallet ? n.times(unitsPerPallet).toString() : "",
    });
  }

  function addRow() {
    setRows((prev) => [...prev, filaVacia(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const computedRows = rows.map((row) => {
    const item = items.find((i) => i.id === row.itemId);
    const cantidad = parseNumeroSuave(row.quantity);
    // Mismo cálculo que hace el servidor al guardar; acá sólo para mostrar.
    const usd = parseNumeroSuave(row.unitPriceUsd);
    const precio =
      enDolares && usd ? usd.times(cotizacionNum!) : parseNumeroSuave(row.unitPrice);
    const subtotal = cantidad && precio ? cantidad.times(precio).toNumber() : 0;
    return { row, item, precio, subtotal };
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
            {fixedEntity ? (
              <>
                <p className={`${inputClass} bg-foreground/5`}>{fixedEntity.name}</p>
                <input type="hidden" name="entityId" value={fixedEntity.id} />
              </>
            ) : (
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
            )}
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
              Cotización del dólar (opcional)
            </label>
            <input
              id="exchangeRate"
              name="exchangeRate"
              inputMode="decimal"
              placeholder="1.481,50"
              value={cotizacion}
              onChange={(e) => setCotizacion(e.target.value)}
              className={inputClass}
            />
            <p className="text-xs text-foreground/50">
              {enDolares
                ? "Las líneas piden el precio en U$S y el peso se calcula con esta cotización."
                : "Cargala si el precio está pactado en dólares, como el soplado de los envases."}
            </p>
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
          {computedRows.map(({ row, item, precio, subtotal }) => (
            // flex-wrap y no una grilla de columnas fijas: la cantidad de campos cambia según el
            // insumo (pallets) y según si hay cotización (precio en U$S), y una grilla con el
            // número de columnas cableado se desalinea en cuanto aparece o desaparece uno.
            <div
              key={row.key}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2"
            >
              <div className="min-w-0 flex-1 basis-[140px]">
                <label className="text-xs text-foreground/60">Tipo</label>
                <select
                  value={row.category}
                  onChange={(e) => changeCategory(row.key, e.target.value as SupplierCategory | "")}
                  className={inputClass}
                >
                  <option value="">— Tipo —</option>
                  {categorias.map((c) => (
                    <option key={c} value={c}>
                      {SUPPLIER_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex-[2] basis-[210px]">
                <label className="text-xs text-foreground/60">Insumo</label>
                <select
                  value={row.itemId}
                  onChange={(e) => changeItem(row.key, e.target.value)}
                  disabled={!row.category}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:bg-foreground/5 disabled:text-foreground/40`}
                >
                  <option value="">{row.category ? "— Insumo —" : "Elegí el tipo primero"}</option>
                  {(row.category ? itemsPorCategoria.get(row.category) ?? [] : []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              {item?.unitsPerPallet && (
                <div className="min-w-0 flex-1 basis-[110px]">
                  {/* Las unidades por pallet van en la etiqueta y no debajo del campo: abajo
                      agrandan la celda y, con items-end, desalinean toda la fila. */}
                  <label className="text-xs text-foreground/60">
                    Pallets <span className="text-foreground/40">(×{formatQuantity(item.unitsPerPallet)})</span>
                  </label>
                  <input
                    value={row.pallets}
                    onChange={(e) => changePallets(row.key, e.target.value, item.unitsPerPallet)}
                    inputMode="decimal"
                    className={inputClass}
                  />
                </div>
              )}
              <div className="min-w-0 flex-1 basis-[120px]">
                <label className="text-xs text-foreground/60">Cantidad {item ? `(${item.unit})` : ""}</label>
                <input
                  value={row.quantity}
                  // Editable aunque haya pallets: si alguna vez llega un pallet incompleto, se
                  // corrige acá sin quedar trabado.
                  onChange={(e) => updateRow(row.key, { quantity: e.target.value, pallets: "" })}
                  inputMode="decimal"
                  className={inputClass}
                />
              </div>
              {enDolares && (
                <div className="min-w-0 flex-1 basis-[110px]">
                  <label className="text-xs text-foreground/60">Precio U$S</label>
                  <input
                    value={row.unitPriceUsd}
                    onChange={(e) => updateRow(row.key, { unitPriceUsd: e.target.value })}
                    inputMode="decimal"
                    placeholder="0,1483"
                    className={inputClass}
                  />
                </div>
              )}
              <div className="min-w-0 flex-1 basis-[120px]">
                <label className="text-xs text-foreground/60">Precio unit.</label>
                {enDolares && row.unitPriceUsd.trim() ? (
                  // Con precio en dólares el de pesos es derivado: mostrarlo editable invitaría a
                  // cambiarlo, y el servidor lo recalcula igual.
                  <p className="px-2 py-2 text-sm tabular-nums">{precio ? formatMoney(precio.toNumber()) : "—"}</p>
                ) : (
                  <input
                    value={row.unitPrice}
                    onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                    inputMode="decimal"
                    className={inputClass}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 basis-[160px]">
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
              <div className="min-w-0 flex-1 basis-[120px]">
                <label className="text-xs text-foreground/60">Subtotal</label>
                <p className="px-2 py-2 text-sm tabular-nums">{formatMoney(subtotal)}</p>
              </div>
              <div className="flex justify-end pb-2">
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
              <input type="hidden" name="lineUnitPriceUsd" value={enDolares ? row.unitPriceUsd : ""} />
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
