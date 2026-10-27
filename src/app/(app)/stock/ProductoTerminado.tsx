import Link from "next/link";
import type { Caja, Prisma, Product } from "@prisma/client";
import { formatQuantity } from "@/lib/money";
import { palletsYCajas } from "@/lib/product-label";

type Formato = { product: Product; pallets: number; cajas: number };

/** Una marca dentro de un tamaño: sus formatos de pallet y las cajas sueltas de esa botella. */
type Fila = { clave: string; nombre: string; aceite: string; formatos: Formato[]; sueltas: number; botellas: number };

type Tamano = { ml: number; filas: Map<string, Fila>; pallets: number; cajas: number };

const plural = (n: number, uno: string, varios: string) => `${formatQuantity(n)} ${Math.abs(n) === 1 ? uno : varios}`;
const rojo = (n: number) => (n < 0 ? "text-red-600 dark:text-red-400" : "");

/** "14 pallets" y "+ 3 cajas" chico; sólo cajas si no hay ningún pallet armado. */
function Cantidad({ pallets, cajas, grande = false }: { pallets: number; cajas: number; grande?: boolean }) {
  const tamano = grande ? "text-2xl" : "text-base";
  if (pallets === 0 && cajas !== 0) {
    return <span className={`${tamano} whitespace-nowrap font-semibold tabular-nums ${rojo(cajas)}`}>{plural(cajas, "caja", "cajas")}</span>;
  }
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className={`${tamano} font-semibold ${rojo(pallets)}`}>{plural(pallets, "pallet", "pallets")}</span>
      {cajas !== 0 && (
        <span className={`ml-1.5 text-sm text-foreground/60 ${rojo(cajas)}`}>+ {plural(cajas, "caja", "cajas")}</span>
      )}
    </span>
  );
}

/**
 * El producto terminado por tamaño de botella, que es como se pregunta en el depósito: "¿cuánto
 * hay de 900?", y después "¿de qué marca y de qué pallet?". Una franja por tamaño con su total, una
 * fila por marca, y en la fila un recuadro por formato de pallet ("de 105 cajas · 25 pallets") con
 * las cajas sueltas al final.
 *
 * Antes se probó una tabla de una fila por formato (no se veía el total y se perdía el renglón),
 * tarjetas por marca (el formato quedaba escondido y se escalonaban) y un cuadro marca × tamaño
 * (con 12 marcas y 7 tamaños no entraba, y el 84 y el 105 de una marca quedaban apilados en el
 * mismo casillero). Así, una marca o un formato nuevo es una fila o un recuadro más, y nada se
 * ensancha.
 *
 * Las cajas sueltas van una sola vez por marca y botella: las de un 84 y un 105 son las mismas
 * cajas, y ponerlas en cada formato las contaría dos veces.
 */
export function ProductoTerminado({
  productos,
  stocks,
  cajas,
  hayFiltro,
  buscando,
}: {
  productos: Product[];
  stocks: Map<string, Prisma.Decimal>;
  /** Las cajas con sueltas o botellas sueltas, ya filtradas por la búsqueda. */
  cajas: { caja: Caja; sueltas: number; botellas: number }[];
  hayFiltro: boolean;
  /** Con una búsqueda el total es sólo de lo que se ve, y tiene que decirlo. */
  buscando: boolean;
}) {
  const tamanos = new Map<number, Tamano>();
  const filaDe = (ml: number, nombre: string, aceite: string) => {
    let tamano = tamanos.get(ml);
    if (!tamano) {
      tamano = { ml, filas: new Map(), pallets: 0, cajas: 0 };
      tamanos.set(ml, tamano);
    }
    const clave = `${nombre}|${aceite}`;
    let fila = tamano.filas.get(clave);
    if (!fila) {
      fila = { clave, nombre, aceite, formatos: [], sueltas: 0, botellas: 0 };
      tamano.filas.set(clave, fila);
    }
    return { tamano, fila };
  };

  for (const product of productos) {
    const stock = stocks.get(product.id);
    if (!stock || stock.isZero()) continue;
    const { pallets, cajas: fraccion } = palletsYCajas(stock, product.boxesPerPallet);
    const { tamano, fila } = filaDe(Number(product.bottleCapacityMl ?? 0), product.name, product.oilType);
    fila.formatos.push({ product, pallets, cajas: fraccion });
    tamano.pallets += pallets;
    tamano.cajas += fraccion;
  }
  for (const { caja, sueltas, botellas } of cajas) {
    const { tamano, fila } = filaDe(Number(caja.bottleCapacityMl), caja.name, caja.oilType);
    fila.sueltas += sueltas;
    fila.botellas += botellas;
    tamano.cajas += sueltas;
  }

  const lista = Array.from(tamanos.values()).sort((a, b) => a.ml - b.ml);
  const total = lista.reduce((acc, t) => ({ pallets: acc.pallets + t.pallets, cajas: acc.cajas + t.cajas }), {
    pallets: 0,
    cajas: 0,
  });

  if (lista.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-foreground/15 p-6 text-center text-sm text-foreground/50">
        {hayFiltro ? "No hay producto terminado con este filtro." : "No hay stock de producto terminado ahora mismo."}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-primary/20 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
          {buscando ? "Total de la búsqueda" : "Total"}
        </span>
        <Cantidad pallets={total.pallets} cajas={total.cajas} grande />
      </div>

      {lista.map((tamano) => {
        const filas = Array.from(tamano.filas.values()).sort(
          (a, b) => a.nombre.localeCompare(b.nombre, "es") || a.aceite.localeCompare(b.aceite, "es")
        );
        return (
          <section key={tamano.ml} className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
            {/* El total pegado al tamaño y no en la otra punta: en la compu quedaba a un metro. */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5">
              <h3 className="font-semibold sm:w-44">{tamano.ml ? `${formatQuantity(tamano.ml)} ml` : "Sin botella"}</h3>
              <Cantidad pallets={tamano.pallets} cajas={tamano.cajas} />
            </div>
            <div className="divide-y divide-foreground/5">
              {filas.map((fila) => {
                const formatos = [...fila.formatos].sort(
                  (a, b) => (b.product.boxesPerPallet ?? 0) - (a.product.boxesPerPallet ?? 0)
                );
                return (
                  <div
                    key={fila.clave}
                    className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 sm:w-44 sm:shrink-0">
                      <p className="font-medium leading-snug">{fila.nombre}</p>
                      <p className="text-xs text-foreground/50">{fila.aceite}</p>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2">
                      {formatos.map((f) => (
                        <Link
                          key={f.product.id}
                          href={`/produccion/${f.product.slug}`}
                          title={`${f.product.name} ${f.product.oilType} ${f.product.presentation}`}
                          className={`flex items-baseline gap-2 rounded-lg border px-3 py-1.5 transition-colors hover:border-primary hover:bg-primary/10 ${
                            f.pallets < 0 || f.cajas < 0 ? "border-red-300 dark:border-red-900/60" : "border-foreground/15"
                          }`}
                        >
                          <span className="whitespace-nowrap text-xs text-foreground/60">
                            {f.product.boxesPerPallet ? `de ${f.product.boxesPerPallet} cajas` : f.product.presentation}
                          </span>
                          <Cantidad pallets={f.pallets} cajas={f.cajas} />
                        </Link>
                      ))}
                      {(fila.sueltas !== 0 || fila.botellas !== 0) && (
                        // Punteado: no es un formato de pallet sino lo que quedó suelto de esa caja.
                        <span className="flex items-baseline gap-2 rounded-lg border border-dashed border-foreground/20 px-3 py-1.5">
                          <span className="whitespace-nowrap text-xs text-foreground/60">sueltas</span>
                          {fila.sueltas !== 0 && (
                            <span className={`whitespace-nowrap text-base font-semibold tabular-nums ${rojo(fila.sueltas)}`}>
                              {plural(fila.sueltas, "caja", "cajas")}
                            </span>
                          )}
                          {fila.botellas !== 0 && (
                            <span className={`whitespace-nowrap text-sm tabular-nums text-foreground/60 ${rojo(fila.botellas)}`}>
                              {fila.sueltas !== 0 ? "+ " : ""}
                              {plural(fila.botellas, "botella", "botellas")}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
