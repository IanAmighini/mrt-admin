"use client";

import { useState } from "react";
import type { Currency } from "@prisma/client";
import { hoyEnInput } from "@/lib/period";
import { formatMoney, parseNumeroSuave } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { ViajeFields, type DestinatarioOption, type ViajeOption } from "./ViajeFields";

type Circuit = "BLANCO" | "NEGRO";
type PriceMap = Record<
  Circuit,
  Record<string, { amount: number; currency: string }>
>;
type Estado = "SANO" | "CON_ROTURAS" | "NO_SIRVE";
type ProductoDevolvible = {
  id: string;
  name: string;
  oilType: string;
  presentation: string;
  boxesPerPallet: number | null;
  unitsPerBox: number | null;
};

type Row = {
  key: number;
  productId: string;
  pallets: string;
  cajas: string;
  botellas: string;
  precio: string;
  estado: Estado;
  cajasRotas: string;
  botellasSanas: string;
  /** Con roturas y pallets: si se volvieron a armar con cajas del stock o se desarmaron. */
  destino: "" | "REARMADO" | "DESARMADO";
};

const filaVacia = (key: number): Row => ({
  key,
  productId: "",
  pallets: "",
  cajas: "",
  botellas: "",
  precio: "",
  estado: "SANO",
  cajasRotas: "",
  botellasSanas: "",
  destino: "",
});

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

const ESTADOS: { value: Estado; label: string; ayuda: string }[] = [
  {
    value: "SANO",
    label: "Sano",
    ayuda: "Vuelve todo al stock tal como vino.",
  },
  {
    value: "CON_ROTURAS",
    label: "Con roturas",
    ayuda:
      "Las cajas rotas se dan de baja y las botellas sanas quedan sueltas, para juntarlas en cajas.",
  },
  {
    value: "NO_SIRVE",
    label: "No sirve nada",
    ayuda: "No entra nada al stock.",
  },
];

/**
 * Lo que un cliente devuelve: vuelve al stock según cómo llegó, y se le hace una nota de crédito por
 * lo que vale. El precio arranca en el de su lista para la cuenta elegida, que es por lo que se le
 * cobró.
 *
 * La cuenta va una sola vez arriba y no en cada línea: una devolución es de un remito, y el remito
 * es de una cuenta. En cada línea estaba escondida y arrancaba siempre en la Cuenta 1.
 */
export function DevolucionFields({
  entityId,
  products,
  priceMapByCircuit,
  moneda = "ARS",
  proximoNumero,
  viajes,
  destinatarios,
  rotuloSubcuenta,
}: {
  entityId: string;
  products: ProductoDevolvible[];
  priceMapByCircuit: PriceMap;
  moneda?: Currency;
  /** El número que le va a tocar, para mostrarlo: lo asigna el servidor al guardar. */
  proximoNumero: string;
  viajes?: ViajeOption[];
  destinatarios?: DestinatarioOption[];
  rotuloSubcuenta?: string;
}) {
  const [circuit, setCircuit] = useState<Circuit>("BLANCO");
  const [cotizacion, setCotizacion] = useState("");
  const [rows, setRows] = useState<Row[]>([filaVacia(0)]);
  const [nextKey, setNextKey] = useState(1);

  const num = (raw: string) => parseNumeroSuave(raw)?.toNumber() ?? 0;
  const cuentaEnDolares = moneda === "USD";
  const cotizacionNum = num(cotizacion);
  // Con cotización, el precio se escribe en la otra moneda que la de la cuenta, como en el remito.
  const enDolares = !cuentaEnDolares && cotizacionNum > 0;
  const enPesos = cuentaEnDolares && cotizacionNum > 0;
  const precioEnLaCuenta = (row: Row) =>
    enDolares
      ? num(row.precio) * cotizacionNum
      : enPesos
        ? num(row.precio) / cotizacionNum
        : num(row.precio);

  const precioDeLista = (c: Circuit, productId: string) => {
    const p = priceMapByCircuit[c]?.[productId];
    return p ? String(p.amount) : "";
  };

  function cambiarCuenta(c: Circuit) {
    setCircuit(c);
    // El precio de lista depende de la cuenta: se vuelve a tomar el de la nueva.
    setRows((prev) =>
      prev.map((r) =>
        r.productId
          ? { ...r, precio: precioDeLista(c, r.productId) || r.precio }
          : r,
      ),
    );
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const updated = { ...r, ...patch };
        if (patch.productId !== undefined)
          updated.precio = precioDeLista(circuit, patch.productId);
        return updated;
      }),
    );
  }

  const productoDe = (row: Row) => products.find((p) => p.id === row.productId);
  function botellasDe(row: Row) {
    const p = productoDe(row);
    const upb = p?.unitsPerBox ?? 0;
    return (
      (num(row.pallets) * (p?.boxesPerPallet ?? 0) + num(row.cajas)) * upb +
      num(row.botellas)
    );
  }
  const total = rows.reduce(
    (acc, r) => acc + botellasDe(r) * precioEnLaCuenta(r),
    0,
  );

  return (
    <>
      <input type="hidden" name="entityId" value={entityId} />
      <p className="text-xs text-foreground/50">
        Lo que vuelve sano entra al stock y lo roto se da de baja. Al cliente se
        le descuenta de la cuenta todo lo devuelto, al precio de cada línea: si
        no se le reconoce algo, poné el precio en 0.
      </p>

      <fieldset className="space-y-1">
        <legend className="text-sm">Cuenta</legend>
        <div className="flex flex-wrap gap-2">
          {(["BLANCO", "NEGRO"] as const).map((c) => (
            <label
              key={c}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                circuit === c
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-foreground/20"
              }`}
            >
              <input
                type="radio"
                checked={circuit === c}
                onChange={() => cambiarCuenta(c)}
                className="sr-only"
              />
              {CIRCUIT_LABELS[c]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <p className="text-sm">Número</p>
          {/* Se numera sola al guardar. Lo que se muestra es el que le toca ahora: si alguien carga
              otra devolución antes, a esta le toca el siguiente. */}
          <p className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-sm text-foreground/70">
            {proximoNumero} <span className="text-xs text-foreground/50">(automático)</span>
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="dev-date">
            Fecha
          </label>
          <input
            id="dev-date"
            type="date"
            name="date"
            required
            defaultValue={hoyEnInput()}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="dev-cotizacion">
            {cuentaEnDolares
              ? "Cotización (si el precio es en $)"
              : "Cotización (si el precio es en U$S)"}
          </label>
          <input
            id="dev-cotizacion"
            name="exchangeRate"
            value={cotizacion}
            onChange={(e) => setCotizacion(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="dev-reason">
          Por qué se devolvió
        </label>
        <input
          id="dev-reason"
          name="reason"
          required
          placeholder="Botellas golpeadas, error de pedido, vencimiento…"
          className={inputClass}
        />
      </div>

      <ViajeFields
        viajes={viajes}
        destinatarios={destinatarios}
        rotulo={rotuloSubcuenta}
        ayudaViaje="Lo devuelto se descuenta del saldo de lo elegido acá, no del resto de la cuenta. El destinatario es a nombre de quién sale el papel."
      />

      <div className="space-y-3">
        <p className="text-sm font-medium">Lo que volvió</p>
        {rows.map((row, i) => {
          const p = productoDe(row);
          const upb = p?.unitsPerBox ?? 0;
          const botellas = botellasDe(row);
          const ayuda = ESTADOS.find((e) => e.value === row.estado)!.ayuda;
          const conPallets = num(row.pallets) > 0;
          return (
            <div
              key={row.key}
              className="space-y-2 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Línea {i + 1}</p>
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setRows((prev) => prev.filter((r) => r.key !== row.key))
                    }
                    className="px-2 text-foreground/40 hover:text-foreground"
                    aria-label="Quitar línea"
                  >
                    ×
                  </button>
                )}
              </div>
              {/* Todos los campos van siempre, aunque no apliquen: el servidor los aparea por posición. */}
              <input type="hidden" name="lineCircuit" value={circuit} />
              <input
                type="hidden"
                name="linePrecioBotella"
                value={enDolares ? "" : row.precio}
              />
              <input
                type="hidden"
                name="linePrecioBotellaUsd"
                value={enDolares ? row.precio : ""}
              />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                <div className="col-span-2 sm:col-span-3">
                  <label className="text-xs text-foreground/60">Producto</label>
                  <select
                    name="lineProductId"
                    value={row.productId}
                    onChange={(e) =>
                      updateRow(row.key, { productId: e.target.value })
                    }
                    className={inputClass}
                  >
                    <option value="">— Producto —</option>
                    {products.map((prod) => (
                      <option key={prod.id} value={prod.id}>
                        {formatProductBrandLabel(prod)} {prod.presentation}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <label className="text-xs text-foreground/60">
                    {enPesos
                      ? "Precio por botella ($)"
                      : enDolares || cuentaEnDolares
                        ? "Precio por botella (U$S)"
                        : "Precio por botella"}
                  </label>
                  <input
                    value={row.precio}
                    onChange={(e) =>
                      updateRow(row.key, { precio: e.target.value })
                    }
                    inputMode="decimal"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-foreground/60">Pallets</label>
                  <input
                    name="lineQuantity"
                    value={row.pallets}
                    onChange={(e) =>
                      updateRow(row.key, { pallets: e.target.value })
                    }
                    inputMode="numeric"
                    placeholder="0"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs text-foreground/60">
                    Cajas sueltas
                  </label>
                  <input
                    name="lineCajas"
                    value={row.cajas}
                    onChange={(e) =>
                      updateRow(row.key, { cajas: e.target.value })
                    }
                    inputMode="numeric"
                    placeholder="0"
                    className={inputClass}
                  />
                </div>
                <div className="col-span-2 sm:col-span-2">
                  <label className="text-xs text-foreground/60">
                    Botellas sueltas
                  </label>
                  <input
                    name="lineBotellas"
                    value={row.botellas}
                    onChange={(e) =>
                      updateRow(row.key, { botellas: e.target.value })
                    }
                    inputMode="numeric"
                    placeholder="0"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-foreground/60">
                  Cómo volvió
                </label>
                <input type="hidden" name="lineEstado" value={row.estado} />
                <div className="flex flex-wrap gap-2">
                  {ESTADOS.map((e) => (
                    <button
                      key={e.value}
                      type="button"
                      onClick={() => updateRow(row.key, { estado: e.value })}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        row.estado === e.value
                          ? "border-primary bg-primary/10 font-medium"
                          : "border-foreground/20 hover:bg-foreground/5"
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-foreground/50">{ayuda}</p>
              </div>

              {row.estado === "CON_ROTURAS" && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                  <div className="sm:col-span-2">
                    <label className="text-xs text-foreground/60">
                      Cajas rotas
                    </label>
                    <input
                      name="lineCajasRotas"
                      value={row.cajasRotas}
                      onChange={(e) =>
                        updateRow(row.key, { cajasRotas: e.target.value })
                      }
                      inputMode="numeric"
                      placeholder="0"
                      className={inputClass}
                    />
                    <p className="mt-0.5 text-xs text-foreground/40">
                      Las que no se pueden vender como caja.
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-foreground/60">
                      Botellas sanas sueltas
                    </label>
                    <input
                      name="lineBotellasSanas"
                      value={row.botellasSanas}
                      onChange={(e) =>
                        updateRow(row.key, { botellasSanas: e.target.value })
                      }
                      inputMode="numeric"
                      placeholder="0"
                      className={inputClass}
                    />
                    <p className="mt-0.5 text-xs text-foreground/40">
                      Las que se rescataron de las cajas rotas
                      {num(row.botellas) > 0 ? " y de las sueltas" : ""}.
                    </p>
                  </div>
                  {conPallets && (
                    <div className="col-span-2">
                      <label className="text-xs text-foreground/60">
                        Los pallets
                      </label>
                      <select
                        name="linePalletsDestino"
                        value={row.destino}
                        onChange={(e) =>
                          updateRow(row.key, {
                            destino: e.target.value as Row["destino"],
                          })
                        }
                        className={inputClass}
                      >
                        <option value="">— Elegí —</option>
                        <option value="REARMADO">
                          Se rearmaron con cajas del stock
                        </option>
                        <option value="DESARMADO">Se desarmaron</option>
                      </select>
                    </div>
                  )}
                </div>
              )}
              {/* Fuera de "Con roturas" los campos van vacíos, pero van: se aparean por posición. */}
              {row.estado !== "CON_ROTURAS" && (
                <>
                  <input type="hidden" name="lineCajasRotas" value="" />
                  <input type="hidden" name="lineBotellasSanas" value="" />
                </>
              )}
              {!(row.estado === "CON_ROTURAS" && conPallets) && (
                <input type="hidden" name="linePalletsDestino" value="" />
              )}

              {botellas > 0 && (
                <p className="text-xs text-foreground/60 tabular-nums">
                  {botellas} botellas{upb > 0 && ` (${upb} por caja)`} · se le
                  descuenta{" "}
                  {formatMoney(botellas * precioEnLaCuenta(row), moneda)}
                  {circuit === "BLANCO" && " + IVA"}
                </p>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setRows((prev) => [...prev, filaVacia(nextKey)]);
            setNextKey((k) => k + 1);
          }}
          className="w-full rounded-lg border border-dashed border-foreground/20 py-2 text-sm text-foreground/60 hover:bg-foreground/5"
        >
          + Agregar línea
        </button>
        <p className="border-t border-foreground/10 pt-2 text-sm font-semibold tabular-nums">
          A descontarle en la {CIRCUIT_LABELS[circuit]}:{" "}
          {formatMoney(total, moneda)}
          {circuit === "BLANCO" && (
            <span className="font-normal text-foreground/60"> + IVA</span>
          )}
        </p>
      </div>

      <button
        type="submit"
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        Registrar devolución
      </button>
    </>
  );
}
