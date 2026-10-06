"use client";

import { useActionState, useMemo, useState } from "react";
import type { Currency } from "@prisma/client";
import { formatMoney, formatQuantity, parseNumeroSuave } from "@/lib/money";
import { formatPallets, formatProductBrandLabel } from "@/lib/product-label";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";
import { desarmadosPorLinea, type StockParaPlan } from "@/lib/plan-de-entrega";
import { useEnvioUnico } from "./useEnvioUnico";
import { SelectBuscable } from "@/components/ui/SelectBuscable";

const IVA_RATE = 21;

type ProductInfo = {
  id: string;
  name: string;
  oilType: string;
  presentation: string;
  boxesPerPallet: number | null;
  unitsPerBox: number | null;
};

type PriceInfo = { amount: number; currency: string };
type PricesByEntity = Record<string, Record<"BLANCO" | "NEGRO", Record<string, PriceInfo>>>;

type PedidoLineaInfo = { productId: string; pallets: number; label: string };
type PedidoPendienteInfo = { id: string; orderNumber: string; status: string; lines: PedidoLineaInfo[] };
type PedidosByEntity = Record<string, PedidoPendienteInfo[]>;

/** La moneda de la cuenta: en una en dólares, el precio por botella ya es en dólares. */
type ClienteInfo = { id: string; name: string; moneda: Currency };
type ViajeInfo = { id: string; nombre: string; destino: string | null };
type DestinatarioInfo = { id: string; nombre: string; taxId: string | null };
type ViajesByEntity = Record<string, ViajeInfo[]>;
type DestinatariosByEntity = Record<string, DestinatarioInfo[]>;

type Row = {
  key: number;
  marcaKey: string;
  productId: string;
  pallets: string;
  /** Cajas sueltas, además de los pallets. */
  cajas: string;
  pricePerBottle: string;
  facturado: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  EN_COLA: "En cola",
  COMPLETADO: "Completado",
  ENTREGADO: "Entregado",
};

function marcaKeyOf(p: { name: string; oilType: string }) {
  return `${p.name} ${p.oilType}`;
}

export function NuevaEntregaForm({
  action,
  clientes,
  products,
  pricesByEntity,
  stock,
  pedidosByEntity,
  viajesByEntity,
  destinatariosByEntity,
  fixedEntity,
}: {
  action: (formData: FormData) => void | Promise<void>;
  clientes: ClienteInfo[];
  products: ProductInfo[];
  pricesByEntity: PricesByEntity;
  /** Lo que hay de cada producto: pallets de su formato y cajas sueltas de su caja. */
  stock: Record<string, StockParaPlan>;
  pedidosByEntity: PedidosByEntity;
  /** Los viajes y destinatarios de cada cliente. Los dos selectores aparecen sólo si el cliente
   * elegido tiene alguno cargado, así que para casi todos el formulario queda igual. */
  viajesByEntity: ViajesByEntity;
  destinatariosByEntity: DestinatariosByEntity;
  /** Si se llega desde la ficha de un cliente puntual, fija el cliente y oculta el selector. */
  fixedEntity?: ClienteInfo;
}) {
  const [entityId, setEntityId] = useState(fixedEntity?.id ?? "");
  // La cotización convierte: con ella cargada, el precio por botella se escribe en dólares y los
  // pesos salen solos. Es lo que hoy se hace a mano para La Campechana.
  const [cotizacion, setCotizacion] = useState("");
  const cliente = fixedEntity ?? clientes.find((c) => c.id === entityId);
  const cuentaEnDolares = cliente?.moneda === "USD";
  // La cotización sólo aparece cuando el precio está en la otra moneda: casi nunca, y verla siempre
  // hacía pensar que había que llenarla. Viene marcada si el cliente tiene algún precio en dólares.
  const tienePrecioEnDolares = Object.values(pricesByEntity[cliente?.id ?? ""] ?? {}).some((porProducto) =>
    Object.values(porProducto).some((p) => p.currency === "USD")
  );
  const [otraMonedaElegida, setOtraMonedaElegida] = useState<boolean | null>(null);
  const otraMoneda = otraMonedaElegida ?? (!cuentaEnDolares && tienePrecioEnDolares);
  const cotizacionNum = otraMoneda ? parseNumeroSuave(cotizacion) : null;
  const hayCotizacion = Boolean(cotizacionNum?.greaterThan(0));
  // Con cotización, el precio se escribe en la otra moneda que la de la cuenta: dólares en una en
  // pesos (La Campechana), pesos en una en dólares.
  const enDolares = !cuentaEnDolares && hayCotizacion;
  const enPesos = cuentaEnDolares && hayCotizacion;
  const monedaCuenta: Currency = cuentaEnDolares ? "USD" : "ARS";

  // El error de la acción —por ejemplo, que no haya stock para entregar— se muestra acá, arriba del
  // botón. Sin esto, cualquier error reemplazaba la pantalla por "This page couldn't load".
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
  const [rows, setRows] = useState<Row[]>([
    { key: 0, marcaKey: "", productId: "", pallets: "", cajas: "", pricePerBottle: "", facturado: true },
  ]);
  const [nextKey, setNextKey] = useState(1);
  const [checkedPedidos, setCheckedPedidos] = useState<Set<string>>(new Set());

  const marcas = useMemo(() => {
    const seen = new Map<string, { key: string; label: string }>();
    for (const p of products) {
      const key = marcaKeyOf(p);
      if (!seen.has(key)) seen.set(key, { key, label: formatProductBrandLabel(p) });
    }
    return Array.from(seen.values());
  }, [products]);

  const productsByMarca = useMemo(() => {
    const map = new Map<string, ProductInfo[]>();
    for (const p of products) {
      const key = marcaKeyOf(p);
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    return map;
  }, [products]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function lookupPrice(productId: string, facturado: boolean): PriceInfo | undefined {
    if (!entityId || !productId) return undefined;
    return pricesByEntity[entityId]?.[facturado ? "BLANCO" : "NEGRO"]?.[productId];
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const updated = { ...r, ...patch };
        if (patch.marcaKey !== undefined) {
          const options = productsByMarca.get(updated.marcaKey) ?? [];
          updated.productId = options[0]?.id ?? "";
        }
        if (patch.productId !== undefined || patch.facturado !== undefined || patch.marcaKey !== undefined) {
          const price = lookupPrice(updated.productId, updated.facturado);
          if (price) updated.pricePerBottle = String(price.amount);
        }
        return updated;
      })
    );
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: nextKey, marcaKey: "", productId: "", pallets: "", cajas: "", pricePerBottle: "", facturado: true },
    ]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  // Sólo para mostrar: la cuenta que vale la hace el servidor con los mismos números. Con
  // `parseNumeroSuave` y no `Number()`, que no entiende la coma y leía "1350,50" como cero.
  const computedRows = rows.map((row) => {
    const product = productById.get(row.productId);
    const pallets = parseNumeroSuave(row.pallets)?.toNumber() ?? 0;
    const cajas = parseNumeroSuave(row.cajas)?.toNumber() ?? 0;
    const perPallet = (product?.boxesPerPallet ?? 0) * (product?.unitsPerBox ?? 0);
    const botellas = pallets * perPallet + cajas * (product?.unitsPerBox ?? 0);
    const escrito = parseNumeroSuave(row.pricePerBottle)?.toNumber() ?? 0;
    const cot = cotizacionNum?.toNumber() ?? 0;
    // En la moneda de la cuenta, que es en la que se guarda.
    const pricePerBottle = enDolares ? escrito * cot : enPesos ? escrito / cot : escrito;
    const subtotal = botellas * pricePerBottle;
    const iva = row.facturado ? subtotal * (IVA_RATE / 100) : 0;
    return { row, product, pallets, cajas, botellas, subtotal, iva, pricePerBottle, perPallet };
  });
  // Cuántos pallets se van a desarmar para sacar las cajas sueltas: se avisa antes de guardar.
  const plan = desarmadosPorLinea(
    computedRows.map((r) => ({ productId: r.row.productId, cajas: r.cajas, boxesPerPallet: r.product?.boxesPerPallet ?? null })),
    stock
  );

  const totals = computedRows.reduce(
    (acc, r) => {
      acc.pallets += r.pallets;
      acc.cajas += r.cajas;
      acc.botellas += r.botellas;
      if (r.row.facturado) acc.facturado += r.subtotal;
      else acc.noFacturado += r.subtotal;
      acc.iva += r.iva;
      return acc;
    },
    { pallets: 0, cajas: 0, botellas: 0, facturado: 0, noFacturado: 0, iva: 0 }
  );
  const total = totals.facturado + totals.iva + totals.noFacturado;

  const pedidosPendientes = entityId ? (pedidosByEntity[entityId] ?? []) : [];
  const viajes = entityId ? (viajesByEntity[entityId] ?? []) : [];
  const destinatarios = entityId ? (destinatariosByEntity[entityId] ?? []) : [];

  return (
    <form action={formAction} onSubmit={unaVez} className="space-y-6">
      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Información general</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="entityId">
              Cliente *
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
                value={entityId}
                onChange={setEntityId}
                opciones={clientes.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Escribí el cliente…"
                className={inputClass}
              />
            )}
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="number">
              Remito *
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
            <label className="flex items-center gap-2 pt-7 text-sm">
              <input
                type="checkbox"
                checked={otraMoneda}
                onChange={(e) => setOtraMonedaElegida(e.target.checked)}
                className="size-4 accent-primary"
              />
              {cuentaEnDolares ? "El precio está en pesos" : "El precio está en dólares"}
            </label>
            {otraMoneda && (
              <>
                <input
                  id="exchangeRate"
                  name="exchangeRate"
                  aria-label="Cotización del dólar"
                  inputMode="decimal"
                  placeholder="Cotización, ej. 1.523"
                  required
                  value={cotizacion}
                  onChange={(e) => setCotizacion(e.target.value)}
                  className={inputClass}
                />
                <p className="text-xs text-foreground/50">
                  {cuentaEnDolares
                    ? "El precio por botella va en pesos; se pasa a dólares con esta cotización."
                    : "El precio por botella va en U$S; los pesos se calculan con esta cotización."}
                </p>
              </>
            )}
          </div>
          {viajes.length > 0 && (
            <div className="space-y-1">
              <label className="text-sm" htmlFor="entregaId">
                Viaje
              </label>
              <select id="entregaId" name="entregaId" className={inputClass} defaultValue="">
                <option value="">— Sin viaje —</option>
                {viajes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.destino ? `${v.nombre} · ${v.destino}` : v.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
          {destinatarios.length > 0 && (
            <div className="space-y-1">
              <label className="text-sm" htmlFor="destinatarioId">
                A nombre de
              </label>
              <select id="destinatarioId" name="destinatarioId" className={inputClass} defaultValue="">
                <option value="">— El cliente mismo —</option>
                {destinatarios.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                    {d.taxId ? ` · ${d.taxId}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Ítems del remito</h2>
          <button type="button" onClick={addRow} className={secondaryButtonClass}>
            + Agregar ítem
          </button>
        </div>

        <div className="space-y-3">
          {computedRows.map(({ row, product, pallets, cajas, botellas, subtotal, iva, pricePerBottle, perPallet }, idx) => {
            const hay = row.productId ? stock[row.productId] : undefined;
            const { aDesarmar, sobran } = plan[idx];
            const formatoOptions = productsByMarca.get(row.marcaKey) ?? [];
            return (
              <div key={row.key} className="grid grid-cols-12 items-end gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-2">
                <div className="col-span-3 min-w-0">
                  <label className="text-xs text-foreground/60">Marca</label>
                  <select
                    value={row.marcaKey}
                    onChange={(e) => updateRow(row.key, { marcaKey: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">— Marca —</option>
                    {marcas.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 min-w-0">
                  <label className="text-xs text-foreground/60">Formato</label>
                  <select
                    value={row.productId}
                    onChange={(e) => updateRow(row.key, { productId: e.target.value })}
                    disabled={!row.marcaKey}
                    className={inputClass}
                  >
                    <option value="">— Formato —</option>
                    {formatoOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.presentation}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1 min-w-0">
                  <label className="text-xs text-foreground/60">Pallets</label>
                  <input
                    value={row.pallets}
                    onChange={(e) => updateRow(row.key, { pallets: e.target.value })}
                    inputMode="numeric"
                    placeholder="0"
                    className={inputClass}
                  />
                </div>
                <div className="col-span-1 min-w-0">
                  <label className="text-xs text-foreground/60">Cajas</label>
                  <input
                    value={row.cajas}
                    onChange={(e) => updateRow(row.key, { cajas: e.target.value })}
                    inputMode="numeric"
                    placeholder="0"
                    className={inputClass}
                  />
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
                  {(enDolares || enPesos) && pricePerBottle > 0 && (
                    <p className="text-xs text-foreground/50 tabular-nums">
                      = {formatMoney(pricePerBottle, monedaCuenta)}/bot.
                      {perPallet > 0 && ` · ${formatMoney(pricePerBottle * perPallet, monedaCuenta)}/pallet`}
                    </p>
                  )}
                </div>
                <div className="col-span-1 min-w-0">
                  <label className="text-xs text-foreground/60">Fact.</label>
                  <button
                    type="button"
                    onClick={() => updateRow(row.key, { facturado: !row.facturado })}
                    className={`w-full rounded border px-2 py-2 text-xs font-medium ${
                      row.facturado
                        ? "border-green-600 bg-green-100 text-green-800 dark:border-green-500 dark:bg-green-900/40 dark:text-green-300"
                        : "border-foreground/20 bg-foreground/5 text-foreground/60"
                    }`}
                  >
                    {row.facturado ? "C/Fact" : "S/Fact"}
                  </button>
                </div>
                <div className="col-span-1 min-w-0">
                  <label className="text-xs text-foreground/60">Subtotal</label>
                  <p className="px-2 py-2 text-sm">
                    {formatMoney(subtotal, monedaCuenta)}
                    {row.facturado && iva > 0 && (
                      <span className="block text-xs text-green-700 dark:text-green-400">+IVA {formatMoney(iva, monedaCuenta)}</span>
                    )}
                  </p>
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

                {/* Lo que hay, y si hace falta desarmar un pallet para sacar las cajas: se ve antes de
                    guardar, en vez de enterarse después mirando el stock. */}
                {hay && (
                  <p className="col-span-12 -mt-1 text-xs text-foreground/50">
                    Hay {formatPallets(hay.pallets, product?.boxesPerPallet ?? null)} de este formato y{" "}
                    {formatQuantity(hay.sueltas)} {hay.sueltas === 1 ? "caja suelta" : "cajas sueltas"} · {formatQuantity(botellas)} botellas
                    {pallets > hay.pallets && (
                      <span className="text-red-600 dark:text-red-400"> · no alcanzan los pallets</span>
                    )}
                    {aDesarmar > 0 && (
                      <span className="block text-amber-700 dark:text-amber-400">
                        Se desarma{aDesarmar === 1 ? "" : "n"} {aDesarmar} {aDesarmar === 1 ? "pallet" : "pallets"}{" "}
                        de {product?.presentation} para sacar las {formatQuantity(cajas)} cajas: quedan {formatQuantity(sobran)} sueltas.
                      </span>
                    )}
                  </p>
                )}
                {/* El precio va tal como se escribió y el servidor hace la cuenta del pallet. Los dos
                    campos van siempre, uno vacío: se aparean por posición. */}
                <input type="hidden" name="lineProductId" value={row.productId} />
                <input type="hidden" name="lineQuantity" value={row.pallets} />
                <input type="hidden" name="lineCajas" value={row.cajas} />
                <input type="hidden" name="linePrecioBotella" value={enDolares ? "" : row.pricePerBottle} />
                <input type="hidden" name="linePrecioBotellaUsd" value={enDolares ? row.pricePerBottle : ""} />
                <input type="hidden" name="lineCircuit" value={row.facturado ? "BLANCO" : "NEGRO"} />
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-end gap-6 border-t border-foreground/10 pt-3 text-sm">
          <div className="text-center">
            <p className="text-xs text-foreground/50">Total</p>
            <p className="font-semibold">
              {formatQuantity(totals.pallets)} pallets
              {totals.cajas > 0 && ` + ${formatQuantity(totals.cajas)} cajas`}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-foreground/50">Total botellas</p>
            <p className="font-semibold">{formatQuantity(totals.botellas)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-green-700 dark:text-green-400">Facturado (s/IVA)</p>
            <p className="font-semibold text-green-700 dark:text-green-400">{formatMoney(totals.facturado, monedaCuenta)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">IVA {IVA_RATE}%</p>
            <p className="font-semibold">{formatMoney(totals.iva, monedaCuenta)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">No facturado</p>
            <p className="font-semibold">{formatMoney(totals.noFacturado, monedaCuenta)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">Total</p>
            <p className="text-lg font-bold">{formatMoney(total, monedaCuenta)}</p>
          </div>
        </div>
      </div>

      {pedidosPendientes.length > 0 && (
        <div className="space-y-2 rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm font-medium">¿Este remito entrega alguno de estos pedidos?</p>
          <p className="text-xs text-foreground/50">
            Los que tildes se marcan como &quot;Entregado&quot; automáticamente al crear el remito.
          </p>
          <div className="space-y-1">
            {pedidosPendientes.map((pedido) => (
              <label key={pedido.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="pedidoId"
                  value={pedido.id}
                  checked={checkedPedidos.has(pedido.id)}
                  onChange={(e) =>
                    setCheckedPedidos((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(pedido.id);
                      else next.delete(pedido.id);
                      return next;
                    })
                  }
                  className="mt-1"
                />
                <span>
                  #{pedido.orderNumber} — {STATUS_LABELS[pedido.status] ?? pedido.status} —{" "}
                  {pedido.lines.map((l) => `${l.label} (${formatQuantity(l.pallets, "pallets")})`).join(", ")}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4 space-y-2">
        <label className="text-sm font-semibold" htmlFor="reason">
          Notas
        </label>
        <textarea id="reason" name="reason" rows={2} placeholder="Notas adicionales…" className={inputClass} />
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
          {pending ? "Creando…" : "Crear entrega"}
        </button>
      </div>
    </form>
  );
}

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const secondaryButtonClass = "rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-1.5 text-sm hover:bg-foreground/5";
