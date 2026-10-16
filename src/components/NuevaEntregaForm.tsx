"use client";

import { useActionState, useMemo, useState } from "react";
import type { Currency } from "@prisma/client";
import { formatMoney, formatQuantity, parseNumeroSuave } from "@/lib/money";
import { formatPallets, formatProductBrandLabel } from "@/lib/product-label";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";
import { desarmadosPorLinea, type StockParaPlan } from "@/lib/plan-de-entrega";
import { useEnvioUnico } from "./useEnvioUnico";
import { SelectBuscable } from "@/components/ui/SelectBuscable";
import { hoyEnInput } from "@/lib/period";
import { Plus, X } from "lucide-react";

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
  saldosByEntity,
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
  /** Lo que ya debe cada cliente, por cuenta, en su moneda. */
  saldosByEntity: Record<string, { blanco: number; negro: number }>;
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
    computedRows.map((r) => ({
      productId: r.row.productId,
      pallets: r.pallets,
      cajas: r.cajas,
      boxesPerPallet: r.product?.boxesPerPallet ?? null,
    })),
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

  const saldo = entityId ? saldosByEntity[entityId] : undefined;
  const usaCuenta1 = computedRows.some((r) => r.row.facturado && r.subtotal > 0);
  const usaCuenta2 = computedRows.some((r) => !r.row.facturado && r.subtotal > 0);

  return (
    <form action={formAction} onSubmit={unaVez} className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        {/* El papel: a quién, qué número y cuándo. Elegido el cliente, lo que ya debe — es lo
            primero que se mira antes de mandarle más mercadería. */}
        <section className={cardClass}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-1">
              <label className={labelClass} htmlFor="entityId">
                Cliente
              </label>
              {fixedEntity ? (
                <>
                  <p className={`${inputClass} bg-foreground/5 font-medium`}>{fixedEntity.name}</p>
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
              <label className={labelClass} htmlFor="number">
                N° de remito
              </label>
              <input id="number" name="number" required placeholder="Ej: 991" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className={labelClass} htmlFor="date">
                Fecha
              </label>
              <input id="date" type="date" name="date" required defaultValue={hoyEnInput()} className={inputClass} />
            </div>
          </div>

          {saldo && (
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg bg-foreground/[0.03] px-3 py-2 text-sm">
              <span className="text-foreground/60">
                {saldo.blanco + saldo.negro < 0 ? "A favor del cliente" : "Ya nos debe"}{" "}
                <strong className="tabular-nums text-foreground">{formatMoney(Math.abs(saldo.blanco + saldo.negro), monedaCuenta)}</strong>
              </span>
              <span className="text-xs tabular-nums text-foreground/50">
                Cuenta 1 {formatMoney(saldo.blanco, monedaCuenta)} · Cuenta 2 {formatMoney(saldo.negro, monedaCuenta)}
              </span>
            </div>
          )}

          {(viajes.length > 0 || destinatarios.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {viajes.length > 0 && (
                <div className="space-y-1">
                  <label className={labelClass} htmlFor="entregaId">
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
                  <label className={labelClass} htmlFor="destinatarioId">
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
          )}

          <div className="space-y-2">
            <label className="flex w-fit items-center gap-2 text-sm text-foreground/70">
              <input
                type="checkbox"
                checked={otraMoneda}
                onChange={(e) => setOtraMonedaElegida(e.target.checked)}
                className="size-4 accent-primary"
              />
              {cuentaEnDolares ? "El precio está en pesos" : "El precio está en dólares"}
            </label>
            {otraMoneda && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <input
                  id="exchangeRate"
                  name="exchangeRate"
                  aria-label="Cotización del dólar"
                  inputMode="decimal"
                  placeholder="Cotización, ej. 1.523"
                  required
                  value={cotizacion}
                  onChange={(e) => setCotizacion(e.target.value)}
                  className={`${inputClass} sm:w-48`}
                />
                <p className="text-xs text-foreground/50">
                  {cuentaEnDolares
                    ? "El precio por botella va en pesos; se pasa a dólares con esta cotización."
                    : "El precio por botella va en U$S; los pesos se calculan con esta cotización."}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Lo que se lleva: un producto por tarjeta, con los números grandes y el subtotal a la
            vista. Antes era un renglón de nueve casilleros donde el subtotal se perdía. */}
        <section className="space-y-3">
          <h2 className="px-1 text-sm font-semibold">Qué se lleva</h2>
          {computedRows.map(({ row, product, cajas, botellas, subtotal, iva, pricePerBottle, perPallet }, idx) => {
            const hay = row.productId ? stock[row.productId] : undefined;
            const { aDesarmar, sobran, faltanPallets, faltanCajas } = plan[idx];
            const formatoOptions = productsByMarca.get(row.marcaKey) ?? [];
            return (
              <div key={row.key} className={`${cardClass} space-y-3`}>
                <div className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                    <div className="space-y-1">
                      <label className={labelClass}>Marca</label>
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
                    <div className="space-y-1">
                      <label className={labelClass}>Formato</label>
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
                  </div>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="mt-6 rounded-lg p-2 text-foreground/40 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      aria-label="Quitar este producto"
                      title="Quitar este producto"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[6rem_6rem_minmax(0,1fr)_auto]">
                  <div className="space-y-1">
                    <label className={labelClass}>Pallets</label>
                    <input
                      value={row.pallets}
                      onChange={(e) => updateRow(row.key, { pallets: e.target.value })}
                      inputMode="numeric"
                      placeholder="0"
                      className={`${inputClass} text-right tabular-nums`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>Cajas sueltas</label>
                    <input
                      value={row.cajas}
                      onChange={(e) => updateRow(row.key, { cajas: e.target.value })}
                      inputMode="numeric"
                      placeholder="0"
                      className={`${inputClass} text-right tabular-nums`}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className={labelClass}>
                      {enPesos ? "Precio por botella ($)" : enDolares || cuentaEnDolares ? "Precio por botella (U$S)" : "Precio por botella"}
                    </label>
                    <input
                      value={row.pricePerBottle}
                      onChange={(e) => updateRow(row.key, { pricePerBottle: e.target.value })}
                      inputMode="decimal"
                      className={`${inputClass} text-right tabular-nums`}
                    />
                    {(enDolares || enPesos) && pricePerBottle > 0 && (
                      <p className="text-xs text-foreground/50 tabular-nums">
                        = {formatMoney(pricePerBottle, monedaCuenta)}/bot.
                        {perPallet > 0 && ` · ${formatMoney(pricePerBottle * perPallet, monedaCuenta)}/pallet`}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className={labelClass}>Va a</span>
                    {/* La cuenta de este producto: lo de la Cuenta 1 se factura y lleva IVA. */}
                    <div className="flex rounded-lg border border-foreground/20 p-0.5" role="group" aria-label="Cuenta">
                      {([true, false] as const).map((fact) => (
                        <button
                          key={String(fact)}
                          type="button"
                          aria-pressed={row.facturado === fact}
                          onClick={() => updateRow(row.key, { facturado: fact })}
                          className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                            row.facturado === fact
                              ? "bg-primary font-medium text-primary-foreground shadow-sm"
                              : "text-foreground/60 hover:bg-foreground/5 hover:text-foreground"
                          }`}
                        >
                          {fact ? "Cuenta 1" : "Cuenta 2"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-foreground/10 pt-3">
                  {/* Lo que hay, y si hace falta desarmar un pallet para sacar las cajas: se ve antes
                      de guardar, en vez de enterarse después mirando el stock. */}
                  <div className="min-w-0 flex-1 text-xs text-foreground/50">
                    {botellas > 0 && (
                      <p>
                        {formatQuantity(botellas)} botellas
                        {hay && (
                          <>
                            {" "}
                            · hay {formatPallets(hay.pallets, product?.boxesPerPallet ?? null)} y {formatQuantity(hay.sueltas)}{" "}
                            {hay.sueltas === 1 ? "caja suelta" : "cajas sueltas"}
                          </>
                        )}
                      </p>
                    )}
                    {!botellas && hay && (
                      <p>
                        Hay {formatPallets(hay.pallets, product?.boxesPerPallet ?? null)} y {formatQuantity(hay.sueltas)}{" "}
                        {hay.sueltas === 1 ? "caja suelta" : "cajas sueltas"}
                      </p>
                    )}
                    {/* No frena: lo que se produce y se entrega en el día se carga a la noche. */}
                    {hay && (faltanPallets > 0 || faltanCajas > 0) && (
                      <p className="text-amber-700 dark:text-amber-400">
                        Todavía no está cargado:{" "}
                        {[
                          faltanPallets > 0 && `${formatQuantity(faltanPallets)} ${faltanPallets === 1 ? "pallet" : "pallets"}`,
                          faltanCajas > 0 && `${formatQuantity(faltanCajas)} ${faltanCajas === 1 ? "caja" : "cajas"}`,
                        ]
                          .filter(Boolean)
                          .join(" y ")}
                        . Se puede entregar igual: queda en negativo hasta que se cargue la producción.
                      </p>
                    )}
                    {hay && aDesarmar > 0 && (
                      <p className="text-amber-700 dark:text-amber-400">
                        Se desarma{aDesarmar === 1 ? "" : "n"} {aDesarmar} {aDesarmar === 1 ? "pallet" : "pallets"} de{" "}
                        {product?.presentation} para sacar las {formatQuantity(cajas)} cajas: quedan {formatQuantity(sobran)} sueltas.
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold tabular-nums">{formatMoney(subtotal, monedaCuenta)}</p>
                    {row.facturado && iva > 0 && (
                      <p className="text-xs tabular-nums text-foreground/50">+ IVA {formatMoney(iva, monedaCuenta)}</p>
                    )}
                  </div>
                </div>

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
          <button
            type="button"
            onClick={addRow}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/20 py-3 text-sm text-foreground/60 transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            <Plus size={16} />
            Agregar otro producto
          </button>
        </section>

        {pedidosPendientes.length > 0 && (
          <section className={cardClass}>
            <div>
              <p className="text-sm font-semibold">¿Este remito entrega alguno de estos pedidos?</p>
              <p className="text-xs text-foreground/50">Los que tildes se marcan como «Entregado» al crear el remito.</p>
            </div>
            <div className="space-y-1">
              {pedidosPendientes.map((pedido) => (
                <label
                  key={pedido.id}
                  className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-foreground/[0.03]"
                >
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
                    className="mt-1 size-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">#{pedido.orderNumber}</span>
                    <span className="text-foreground/50"> · {STATUS_LABELS[pedido.status] ?? pedido.status}</span>
                    <span className="block text-xs text-foreground/60">
                      {pedido.lines.map((l) => `${l.label} (${formatQuantity(l.pallets, "pallets")})`).join(", ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}

        <section className={cardClass}>
          <label className="text-sm font-semibold" htmlFor="reason">
            Notas <span className="font-normal text-foreground/40">(opcional)</span>
          </label>
          <textarea id="reason" name="reason" rows={2} placeholder="Chofer, patente, algo que haya que recordar…" className={inputClass} />
        </section>
      </div>

      {/* El resumen queda a la vista mientras se cargan los productos, con el botón al pie: así se
          ve el total antes de guardar sin bajar hasta el final. */}
      <aside className={`${cardClass} lg:sticky lg:top-6`}>
        <h2 className="text-sm font-semibold">Resumen</h2>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-foreground/60">Lleva</span>
          <span className="text-right font-medium tabular-nums">
            {formatQuantity(totals.pallets)} {totals.pallets === 1 ? "pallet" : "pallets"}
            {totals.cajas > 0 && ` + ${formatQuantity(totals.cajas)} cajas`}
            <span className="block text-xs font-normal text-foreground/50">{formatQuantity(totals.botellas)} botellas</span>
          </span>
        </div>
        {usaCuenta1 && (
          <div className="space-y-1 border-t border-foreground/10 pt-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">Cuenta 1 (c/factura)</p>
            <div className="flex justify-between">
              <span className="text-foreground/60">Neto</span>
              <span className="tabular-nums">{formatMoney(totals.facturado, monedaCuenta)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground/60">IVA {IVA_RATE}%</span>
              <span className="tabular-nums">{formatMoney(totals.iva, monedaCuenta)}</span>
            </div>
          </div>
        )}
        {usaCuenta2 && (
          <div className="space-y-1 border-t border-foreground/10 pt-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">Cuenta 2 (s/factura)</p>
            <div className="flex justify-between">
              <span className="text-foreground/60">Total</span>
              <span className="tabular-nums">{formatMoney(totals.noFacturado, monedaCuenta)}</span>
            </div>
          </div>
        )}
        <div className="flex items-baseline justify-between border-t border-foreground/10 pt-3">
          <span className="text-sm font-medium">Total del remito</span>
          <span className="text-2xl font-semibold tabular-nums">{formatMoney(total, monedaCuenta)}</span>
        </div>
        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? "Creando…" : "Crear entrega"}
        </button>
      </aside>
    </form>
  );
}

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const cardClass = "space-y-4 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm";
const labelClass = "text-xs text-foreground/60";
