"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatQuantity } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";

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

type ClienteInfo = { id: string; name: string };

type Row = {
  key: number;
  marcaKey: string;
  productId: string;
  pallets: string;
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
  pedidosByEntity,
}: {
  action: (formData: FormData) => void | Promise<void>;
  clientes: ClienteInfo[];
  products: ProductInfo[];
  pricesByEntity: PricesByEntity;
  pedidosByEntity: PedidosByEntity;
}) {
  const [entityId, setEntityId] = useState("");
  const [rows, setRows] = useState<Row[]>([
    { key: 0, marcaKey: "", productId: "", pallets: "", pricePerBottle: "", facturado: true },
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
      { key: nextKey, marcaKey: "", productId: "", pallets: "", pricePerBottle: "", facturado: true },
    ]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  const computedRows = rows.map((row) => {
    const product = productById.get(row.productId);
    const pallets = Number(row.pallets) || 0;
    const perPallet = (product?.boxesPerPallet ?? 0) * (product?.unitsPerBox ?? 0);
    const botellas = pallets * perPallet;
    const pricePerBottle = Number(row.pricePerBottle) || 0;
    const subtotal = botellas * pricePerBottle;
    const iva = row.facturado ? subtotal * (IVA_RATE / 100) : 0;
    const unitPrice = pricePerBottle * perPallet; // precio equivalente por pallet, lo que se guarda
    return { row, product, pallets, botellas, subtotal, iva, unitPrice };
  });

  const totals = computedRows.reduce(
    (acc, r) => {
      acc.pallets += r.pallets;
      acc.botellas += r.botellas;
      if (r.row.facturado) acc.facturado += r.subtotal;
      else acc.noFacturado += r.subtotal;
      acc.iva += r.iva;
      return acc;
    },
    { pallets: 0, botellas: 0, facturado: 0, noFacturado: 0, iva: 0 }
  );
  const total = totals.facturado + totals.iva + totals.noFacturado;

  const pedidosPendientes = entityId ? (pedidosByEntity[entityId] ?? []) : [];

  return (
    <form action={action} className="space-y-6">
      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4 space-y-3">
        <h2 className="text-sm font-semibold">Información general</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="entityId">
              Cliente *
            </label>
            <select
              id="entityId"
              name="entityId"
              required
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className={inputClass}
            >
              <option value="">— Elegir cliente —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
          {computedRows.map(({ row, botellas, subtotal, iva, unitPrice }) => {
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
                    inputMode="decimal"
                    className={inputClass}
                  />
                </div>
                <div className="col-span-1 min-w-0">
                  <label className="text-xs text-foreground/60">Botellas</label>
                  <p className="px-2 py-2 text-sm text-foreground/60">{formatQuantity(botellas)}</p>
                </div>
                <div className="col-span-2 min-w-0">
                  <label className="text-xs text-foreground/60">Precio/bot.</label>
                  <input
                    value={row.pricePerBottle}
                    onChange={(e) => updateRow(row.key, { pricePerBottle: e.target.value })}
                    inputMode="decimal"
                    className={inputClass}
                  />
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
                    {formatMoney(subtotal)}
                    {row.facturado && iva > 0 && (
                      <span className="block text-xs text-green-700 dark:text-green-400">+IVA {formatMoney(iva)}</span>
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

                <input type="hidden" name="lineProductId" value={row.productId} />
                <input type="hidden" name="lineQuantity" value={row.pallets} />
                <input type="hidden" name="lineUnitPrice" value={unitPrice} />
                <input type="hidden" name="lineCircuit" value={row.facturado ? "BLANCO" : "NEGRO"} />
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-end gap-6 border-t border-foreground/10 pt-3 text-sm">
          <div className="text-center">
            <p className="text-xs text-foreground/50">Total pallets</p>
            <p className="font-semibold">{formatQuantity(totals.pallets)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-foreground/50">Total botellas</p>
            <p className="font-semibold">{formatQuantity(totals.botellas)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-green-700 dark:text-green-400">Facturado (s/IVA)</p>
            <p className="font-semibold text-green-700 dark:text-green-400">{formatMoney(totals.facturado)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">IVA {IVA_RATE}%</p>
            <p className="font-semibold">{formatMoney(totals.iva)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">No facturado</p>
            <p className="font-semibold">{formatMoney(totals.noFacturado)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">Total</p>
            <p className="text-lg font-bold">{formatMoney(total)}</p>
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

      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
        >
          Crear entrega
        </button>
      </div>
    </form>
  );
}

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const secondaryButtonClass = "rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-1.5 text-sm hover:bg-foreground/5";
