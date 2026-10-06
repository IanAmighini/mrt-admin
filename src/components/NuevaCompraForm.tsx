"use client";

import { useActionState, useMemo, useState } from "react";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";
import type { Currency, SupplierCategory } from "@prisma/client";
import {
  DEFAULT_IVA_RATE,
  formatMoney,
  formatNumeroEditable,
  formatQuantity,
  parseNumeroSuave,
  toDecimal,
  ZERO,
} from "@/lib/money";
import { computeGastoTotals, filasDesdeValores } from "@/lib/impuestos";
import { SUPPLIER_CATEGORY_LABELS, SUPPLIER_CATEGORY_ORDER } from "@/lib/labels";
import { DENSIDAD_TEXTO, litrosDeKilos } from "@/lib/aceite";
import { FacturaDeCompraFields } from "./FacturaDeCompraFields";
import {
  ImpuestosFields,
  impuestosIniciales,
  type ImpuestosValores,
} from "./ImpuestosFields";
import { useEnvioUnico } from "./useEnvioUnico";
import { SelectBuscable } from "@/components/ui/SelectBuscable";

type Circuit = "BLANCO" | "NEGRO";

/** La moneda manda: en una cuenta en dólares, todos los precios de la compra son dólares. */
type ProveedorInfo = { id: string; name: string; moneda: Currency };
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
  /** Aceite: los kilos del ticket de balanza. Los litros salen de acá. */
  kilos: string;
  /** Aceite: el precio en U$S por tonelada. */
  precioTonelada: string;
  circuit: Circuit;
};

/** Una línea ya cargada, para abrir el formulario al editar. */
export type FilaDeCompra = Omit<Row, "key" | "category" | "pallets">;

const filaVacia = (key: number): Row => ({
  key,
  category: "",
  itemId: "",
  pallets: "",
  quantity: "",
  unitPrice: "",
  unitPriceUsd: "",
  kilos: "",
  precioTonelada: "",
  circuit: "BLANCO",
});

export type { ItemInfo as ItemDeCompra, ProveedorInfo as ProveedorDeCompra };

/**
 * Los campos de una compra, sin el `<form>`: así los puede usar tanto la pantalla propia como el
 * modal de "Cargar" de la ficha del proveedor, que trae su propio form.
 */
export function NuevaCompraFields({
  proveedores,
  items,
  fixedEntity,
  textoBoton = "Crear compra",
  editingDocumentId,
  defaultValues,
  defaultRows,
  impuestosDefaults,
  factura,
  error,
  pending,
}: {
  proveedores: ProveedorInfo[];
  items: ItemInfo[];
  /** Si se llega desde la ficha de un proveedor puntual, fija el proveedor y oculta el selector. */
  fixedEntity?: ProveedorInfo;
  textoBoton?: string;
  /** Al editar: la compra que se reemplaza. Es el mismo formulario que el alta, a propósito: uno
   * aparte para editar se había quedado atrás y no mostraba ni el precio en pesos derivado. */
  editingDocumentId?: string;
  defaultValues?: { number?: string; date?: string; dueDate?: string; exchangeRate?: string };
  defaultRows?: FilaDeCompra[];
  impuestosDefaults?: ImpuestosValores;
  factura?: { number: string; date: string };
  /** El error de la acción, cuando el formulario no vive adentro de un FormModal que ya lo muestra. */
  error?: string | null;
  pending?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    defaultRows && defaultRows.length > 0
      ? defaultRows.map((fila, i) => ({
          ...filaVacia(i),
          ...fila,
          // El tipo no se guarda: sale del insumo, para que el desplegable abra en el suyo.
          category: items.find((it) => it.id === fila.itemId)?.category ?? "",
        }))
      : [filaVacia(0)]
  );
  const [nextKey, setNextKey] = useState(() => Math.max(1, defaultRows?.length ?? 1));
  const [proveedorId, setProveedorId] = useState(fixedEntity?.id ?? "");
  const proveedor = fixedEntity ?? proveedores.find((p) => p.id === proveedorId);
  const moneda: Currency = proveedor?.moneda ?? "ARS";
  const cuentaEnDolares = moneda === "USD";
  // En una cuenta en pesos, la cotización es lo que convierte: con ella cargada, las líneas piden el
  // precio en U$S y el de pesos pasa a ser derivado. En una en dólares no convierte nada.
  const [cotizacion, setCotizacion] = useState(defaultValues?.exchangeRate ?? "");
  const [impuestos, setImpuestos] = useState<ImpuestosValores>(() => impuestosIniciales(impuestosDefaults));
  const cotizacionNum = parseNumeroSuave(cotizacion);
  const hayCotizacion = cotizacionNum !== null && cotizacionNum.greaterThan(0);
  // Con cotización, los precios se escriben en la otra moneda que la de la cuenta.
  const enDolares = !cuentaEnDolares && hayCotizacion;
  const enPesos = cuentaEnDolares && hayCotizacion;
  const plata = (n: number) => formatMoney(n, moneda);

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
      kilos: "",
      precioTonelada: "",
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

  /** Cantidad cargada y precio vacío: la línea entra igual, sin cargo. */
  const cantidadSinPrecio = (row: Row) =>
    Boolean(parseNumeroSuave(row.quantity)?.greaterThan(0) || parseNumeroSuave(row.kilos)?.greaterThan(0)) &&
    !row.unitPrice.trim() &&
    !row.unitPriceUsd.trim() &&
    !row.precioTonelada.trim();

  // Mismo cálculo que hace el servidor al guardar; acá sólo para mostrar.
  const computedRows = rows.map((row) => {
    const item = items.find((i) => i.id === row.itemId);
    const esAceite = item?.category === "ACEITE";

    if (esAceite) {
      const kilos = parseNumeroSuave(row.kilos);
      const ton = parseNumeroSuave(row.precioTonelada);
      const litros = kilos && kilos.greaterThan(0) ? litrosDeKilos(kilos) : null;
      const enUsd = kilos && ton ? kilos.dividedBy(1000).times(ton) : null;
      const subtotal = enUsd
        ? cuentaEnDolares
          ? enUsd.toNumber()
          : cotizacionNum?.greaterThan(0)
            ? enUsd.times(cotizacionNum).toNumber()
            : 0
        : 0;
      return { row, item, esAceite, litros, precio: null, subtotal, faltaCotizacion: Boolean(enUsd && !cuentaEnDolares && !cotizacionNum?.greaterThan(0)) };
    }

    const cantidad = parseNumeroSuave(row.quantity);
    const usd = parseNumeroSuave(row.unitPriceUsd);
    const escrito = parseNumeroSuave(row.unitPrice);
    const precio =
      enDolares && usd ? usd.times(cotizacionNum!) : enPesos && escrito ? escrito.dividedBy(cotizacionNum!) : escrito;
    const subtotal = cantidad && precio ? cantidad.times(precio).toNumber() : 0;
    return { row, item, esAceite, litros: null, precio, subtotal, faltaCotizacion: false };
  });

  const netos = computedRows.reduce(
    (acc, r) => {
      acc[r.row.circuit] += r.subtotal;
      return acc;
    },
    { BLANCO: 0, NEGRO: 0 }
  );

  // Mismo cálculo que hace `impuestosDeCompra` en el servidor, sólo para mostrarlo mientras se
  // carga. Sin líneas en Blanco no hay comprobante facturado, así que no hay sobre qué aplicar
  // tributos: sin este corte, mover la última línea a Negro dejaba un "Total Blanco" con la
  // percepción suelta.
  const hayBlanco = netos.BLANCO > 0;
  const filas = hayBlanco ? filasDesdeValores(impuestos) : [];
  // Igual que el servidor: sin reparto cargado, el neto entero va al 21%.
  const filasEfectivas =
    filas.some((f) => f.kind === "IVA" || f.kind === "NO_GRAVADO")
      ? filas
      : hayBlanco
        ? [
            {
              kind: "IVA" as const,
              base: toDecimal(netos.BLANCO),
              rate: toDecimal(DEFAULT_IVA_RATE),
              amount: toDecimal(netos.BLANCO).times(DEFAULT_IVA_RATE).dividedBy(100),
            },
            ...filas,
          ]
        : [];
  const desglose = computeGastoTotals(
    filasEfectivas,
    hayBlanco ? (parseNumeroSuave(impuestos.retentionAmount ?? "") ?? ZERO) : ZERO
  );
  const iva = desglose.ivaAmount.toNumber();
  const totalBlanco = desglose.totalAmount.toNumber();
  const totals = { BLANCO: totalBlanco, NEGRO: netos.NEGRO, total: totalBlanco + netos.NEGRO };

  return (
    <div className="space-y-6">
      {editingDocumentId && <input type="hidden" name="documentId" value={editingDocumentId} />}
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
              <SelectBuscable
                id="entityId"
                name="entityId"
                required
                value={proveedorId}
                onChange={setProveedorId}
                opciones={proveedores.map((p) => ({ value: p.id, label: p.name }))}
                placeholder="Escribí el proveedor…"
                className={inputClass}
              />
            )}
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="number">
              Número *
            </label>
            <input
              id="number"
              name="number"
              required
              placeholder="Ej: 991"
              defaultValue={defaultValues?.number}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="date">
              Fecha *
            </label>
            <input id="date" type="date" name="date" required defaultValue={defaultValues?.date} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="dueDate">
              Vencimiento (opcional)
            </label>
            <input id="dueDate" type="date" name="dueDate" defaultValue={defaultValues?.dueDate} className={inputClass} />
          </div>
          {/* La moneda no se elige: es la de la cuenta del proveedor. Elegirla a mano es lo que
              hacía que una compra a Cristian en dólares entrara en pesos. */}
          <div className="space-y-1">
            <p className="text-sm">Moneda</p>
            <p className={`${inputClass} bg-foreground/5`}>
              {cuentaEnDolares ? "Dólares — la cuenta se lleva en U$S" : "Pesos"}
            </p>
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
              {cuentaEnDolares
                ? enPesos
                  ? "Los precios van en pesos y se pasan a dólares con esta cotización. El aceite sigue en U$S por tonelada."
                  : "Vacía, los precios van en dólares. Cargala si algún precio está en pesos."
                : enDolares
                  ? "Las líneas piden el precio en U$S y el peso se calcula con esta cotización."
                  : "Cargala si el precio está pactado en dólares, como el soplado de los envases o el aceite."}
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
          {computedRows.map(({ row, item, esAceite, litros, precio, subtotal, faltaCotizacion }) => (
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
                {/* Se puede buscar el insumo directo, sin elegir antes el tipo: el tipo sale del
                    insumo. Con el tipo elegido, la lista se acota a ese tipo. */}
                <SelectBuscable
                  value={row.itemId}
                  onChange={(itemId) => {
                    const elegido = items.find((i) => i.id === itemId);
                    changeItem(row.key, itemId, elegido ? { category: elegido.category } : {});
                  }}
                  opciones={(row.category ? itemsPorCategoria.get(row.category) ?? [] : items).map((i) => ({
                    value: i.id,
                    label: i.name,
                    detalle: row.category ? undefined : SUPPLIER_CATEGORY_LABELS[i.category],
                  }))}
                  placeholder="Escribí el insumo…"
                  className={inputClass}
                />
              </div>
              {esAceite ? (
                <>
                  {/* El aceite entra por el ticket de balanza: kilos y precio por tonelada. Los
                      litros y la plata son una cuenta, y se muestran para que se vea si dan. */}
                  <div className="min-w-0 flex-1 basis-[130px]">
                    <label className="text-xs text-foreground/60">Kilos (ticket)</label>
                    <input
                      value={row.kilos}
                      onChange={(e) => updateRow(row.key, { kilos: e.target.value })}
                      inputMode="decimal"
                      placeholder="28.100"
                      className={inputClass}
                    />
                  </div>
                  <div className="min-w-0 flex-1 basis-[130px]">
                    <label className="text-xs text-foreground/60">U$S por tonelada</label>
                    <input
                      value={row.precioTonelada}
                      onChange={(e) => updateRow(row.key, { precioTonelada: e.target.value })}
                      inputMode="decimal"
                      placeholder="1.250"
                      className={inputClass}
                    />
                  </div>
                  <div className="min-w-0 flex-1 basis-[120px]">
                    <label className="text-xs text-foreground/60">Litros (kilos ÷ {DENSIDAD_TEXTO})</label>
                    <p className="px-2 py-2 text-sm tabular-nums">{litros ? formatQuantity(litros, "L") : "—"}</p>
                  </div>
                </>
              ) : (
                <>
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
                <label className="text-xs text-foreground/60">
                  {enPesos ? "Precio $" : cuentaEnDolares ? "Precio U$S" : "Precio unit."}
                </label>
                {enDolares && row.unitPriceUsd.trim() ? (
                  // Con precio en dólares el de pesos es derivado: mostrarlo editable invitaría a
                  // cambiarlo, y el servidor lo recalcula igual.
                  <p className="px-2 py-2 text-sm tabular-nums">{precio ? plata(precio.toNumber()) : "—"}</p>
                ) : (
                  <input
                    value={row.unitPrice}
                    onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                    inputMode="decimal"
                    className={inputClass}
                  />
                )}
                {enPesos && precio && (
                  <p className="text-xs text-foreground/50 tabular-nums">= {plata(precio.toNumber())}</p>
                )}
              </div>
                </>
              )}
              <div className="min-w-0 flex-1 basis-[160px]">
                <label className="text-xs text-foreground/60">Cuenta</label>
                <select
                  value={row.circuit}
                  onChange={(e) => updateRow(row.key, { circuit: e.target.value as Circuit })}
                  className={inputClass}
                >
                  <option value="BLANCO">Cuenta 1 (c/factura)</option>
                  <option value="NEGRO">Cuenta 2 (s/factura)</option>
                </select>
              </div>
              <div className="min-w-0 flex-1 basis-[120px]">
                <label className="text-xs text-foreground/60">Subtotal</label>
                {/* Una línea sin precio ya no se descarta: entra sin cargo. Decirlo con palabras y
                    no con "$ 0,00" es lo que diferencia una decisión de un olvido. */}
                <p className="px-2 py-2 text-sm tabular-nums">
                  {faltaCotizacion ? (
                    <span className="text-amber-700 dark:text-amber-400">falta la cotización</span>
                  ) : cantidadSinPrecio(row) ? (
                    <span className="text-foreground/50">sin cargo</span>
                  ) : (
                    plata(subtotal)
                  )}
                </p>
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

              {/* Todos los campos van siempre, vacíos si no aplican: el servidor los aparea por
                  posición, y uno que falte en una línea corre los de las siguientes. */}
              <input type="hidden" name="lineItemId" value={row.itemId} />
              <input type="hidden" name="lineQuantity" value={esAceite ? "" : row.quantity} />
              <input type="hidden" name="lineUnitPrice" value={esAceite ? "" : row.unitPrice} />
              <input type="hidden" name="lineUnitPriceUsd" value={!esAceite && enDolares ? row.unitPriceUsd : ""} />
              <input type="hidden" name="lineKilos" value={esAceite ? row.kilos : ""} />
              <input type="hidden" name="linePrecioTonelada" value={esAceite ? row.precioTonelada : ""} />
              <input type="hidden" name="lineCircuit" value={row.circuit} />
            </div>
          ))}
        </div>

        {netos.BLANCO > 0 && (
          <>
            <ImpuestosFields defaults={impuestosDefaults} onChange={setImpuestos} netoDeLineas={netos.BLANCO} />
            <FacturaDeCompraFields defaultNumber={factura?.number} defaultDate={factura?.date} />
          </>
        )}

        <div className="flex flex-wrap justify-end gap-6 border-t border-foreground/10 pt-3 text-sm">
          <div className="text-right">
            <p className="text-xs text-foreground/50">Neto Cuenta 1</p>
            <p className="font-semibold">{plata(netos.BLANCO)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">IVA</p>
            <p className="font-semibold">{plata(iva)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">Total Cuenta 1</p>
            <p className="font-semibold">{plata(totals.BLANCO)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">Total Cuenta 2</p>
            <p className="font-semibold">{plata(totals.NEGRO)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">Total</p>
            <p className="text-lg font-bold">{plata(totals.total)}</p>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {textoBoton}
        </button>
      </div>
    </div>
  );
}

/** La pantalla propia: los mismos campos dentro de su form. */
export function NuevaCompraForm({
  action,
  ...props
}: {
  action: (formData: FormData) => void | Promise<void>;
  proveedores: ProveedorInfo[];
  items: ItemInfo[];
  fixedEntity?: ProveedorInfo;
}) {
  // Sin esto, un error —que no haya stock, que falte la cotización— reemplazaba la pantalla entera
  // por "This page couldn't load" y se perdía todo lo cargado.
  const [error, formAction, pending] = useActionState<string | null, FormData>(async (_prev, formData) => {
    try {
      await action(formData);
      return null;
    } catch (e) {
      if (esSenalDeNavegacion(e)) throw e;
      return userErrorMessage(e);
    }
  }, null);
  const unaVez = useEnvioUnico(pending);

  return (
    <form action={formAction} onSubmit={unaVez}>
      <NuevaCompraFields {...props} error={error} pending={pending} />
    </form>
  );
}

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const secondaryButtonClass = "rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-1.5 text-sm hover:bg-foreground/5";
