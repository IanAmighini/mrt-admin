import Link from "next/link";
import type { Caja, Prisma, Product } from "@prisma/client";
import { ChevronRight, Layers } from "lucide-react";
import { formatQuantity } from "@/lib/money";
import { palletsYCajas } from "@/lib/product-label";

type Formato = { product: Product; pallets: number; cajas: number; negativo: boolean };

/** Una caja de una marca (12 × 900 ml): los formatos que se arman con ella y sus cajas sueltas. */
type Grupo = {
  clave: string;
  ml: number;
  porCaja: number | null;
  formatos: Formato[];
  sueltas: number;
  botellas: number;
};

type Marca = { clave: string; nombre: string; aceite: string; grupos: Grupo[]; pallets: number; cajas: number };

const plural = (n: number, uno: string, varios: string) => `${formatQuantity(n)} ${Math.abs(n) === 1 ? uno : varios}`;
const rojo = (n: number) => (n < 0 ? "text-red-600 dark:text-red-400" : "");

/**
 * "14 pallets" grande y "+ 3 cajas" chico; lo que hay en el depósito, en el orden en que se cuenta.
 * `apilada` pone las cajas abajo: en los cuadros chicos de arriba, al lado no entraban.
 */
function Cantidad({
  pallets,
  cajas,
  grande = false,
  apilada = false,
}: {
  pallets: number;
  cajas: number;
  grande?: boolean;
  apilada?: boolean;
}) {
  // Sólo cajas (una marca que no tiene pallets armados): el número grande son las cajas.
  if (pallets === 0 && cajas !== 0) {
    return (
      <span className={`${grande ? "text-2xl" : "text-base"} whitespace-nowrap font-semibold tabular-nums ${rojo(cajas)}`}>
        {plural(cajas, "caja", "cajas")}
      </span>
    );
  }
  return (
    <span className={`tabular-nums ${apilada ? "flex flex-col" : "whitespace-nowrap"}`}>
      <span className={`${grande ? "text-2xl" : "text-base"} whitespace-nowrap font-semibold ${rojo(pallets)}`}>
        {plural(pallets, "pallet", "pallets")}
      </span>
      {cajas !== 0 && (
        <span className={`whitespace-nowrap text-sm text-foreground/60 ${apilada ? "" : "ml-1"} ${rojo(cajas)}`}>
          + {plural(cajas, "caja", "cajas")}
        </span>
      )}
    </span>
  );
}

/**
 * El producto terminado por marca, en tarjetas. Antes era una tabla de una fila por formato
 * (Marca · Aceite · Formato · Stock) y otra aparte para las cajas sueltas: con once filas no se veía
 * cuántos pallets había en total, y seguir una fila hasta el número de la otra punta hacía perder
 * el renglón. Ahora arriba van los totales —en general y por tamaño de botella— y abajo una
 * tarjeta por marca con sus formatos agrupados por caja.
 *
 * Las cajas sueltas van una sola vez por caja, abajo de los formatos que la usan: las de un 84 y un
 * 105 de la misma marca y botella son las mismas cajas, y repetirlas en cada formato las contaría
 * dos veces.
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
  const marcas = new Map<string, Marca>();
  const marcaDe = (nombre: string, aceite: string) => {
    const clave = `${nombre}|${aceite}`;
    let marca = marcas.get(clave);
    if (!marca) {
      marca = { clave, nombre, aceite, grupos: [], pallets: 0, cajas: 0 };
      marcas.set(clave, marca);
    }
    return marca;
  };
  const grupoDe = (marca: Marca, clave: string, ml: number, porCaja: number | null) => {
    let grupo = marca.grupos.find((g) => g.clave === clave);
    if (!grupo) {
      grupo = { clave, ml, porCaja, formatos: [], sueltas: 0, botellas: 0 };
      marca.grupos.push(grupo);
    }
    return grupo;
  };

  for (const product of productos) {
    const stock = stocks.get(product.id);
    if (!stock || stock.isZero()) continue;
    const { pallets, cajas: fraccion } = palletsYCajas(stock, product.boxesPerPallet);
    const marca = marcaDe(product.name, product.oilType);
    // Sin caja asignada (un producto viejo al que nunca se le cargó una producción) se agrupa por
    // botella y unidades, que es lo mismo que define la caja.
    const clave = product.cajaId ?? `${product.bottleCapacityMl}x${product.unitsPerBox}`;
    grupoDe(marca, clave, Number(product.bottleCapacityMl ?? 0), product.unitsPerBox).formatos.push({
      product,
      pallets,
      cajas: fraccion,
      negativo: stock.isNegative(),
    });
    marca.pallets += pallets;
    marca.cajas += fraccion;
  }
  for (const { caja, sueltas, botellas } of cajas) {
    const marca = marcaDe(caja.name, caja.oilType);
    const grupo = grupoDe(marca, caja.id, Number(caja.bottleCapacityMl), caja.unitsPerBox);
    grupo.sueltas += sueltas;
    grupo.botellas += botellas;
    marca.cajas += sueltas;
  }

  const lista = Array.from(marcas.values()).sort(
    (a, b) => a.nombre.localeCompare(b.nombre, "es") || a.aceite.localeCompare(b.aceite, "es")
  );
  for (const marca of lista) {
    marca.grupos.sort((a, b) => a.ml - b.ml || (a.porCaja ?? 0) - (b.porCaja ?? 0));
    for (const grupo of marca.grupos) {
      grupo.formatos.sort((a, b) => (b.product.boxesPerPallet ?? 0) - (a.product.boxesPerPallet ?? 0));
    }
  }

  // Los totales por tamaño de botella: "¿cuántos pallets de 900 hay?" es la pregunta de todos los días.
  const porTamano = new Map<number, { pallets: number; cajas: number }>();
  for (const marca of lista) {
    for (const grupo of marca.grupos) {
      const t = porTamano.get(grupo.ml) ?? { pallets: 0, cajas: 0 };
      for (const f of grupo.formatos) {
        t.pallets += f.pallets;
        t.cajas += f.cajas;
      }
      t.cajas += grupo.sueltas;
      porTamano.set(grupo.ml, t);
    }
  }
  const tamanos = Array.from(porTamano.entries()).sort(([a], [b]) => a - b);
  const total = lista.reduce((acc, m) => ({ pallets: acc.pallets + m.pallets, cajas: acc.cajas + m.cajas }), {
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 flex min-w-0 flex-col justify-center rounded-xl bg-primary/20 px-4 py-3 sm:col-span-1 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/60">{buscando ? "Total de la búsqueda" : "Total"}</p>
          <Cantidad pallets={total.pallets} cajas={total.cajas} grande apilada />
        </div>
        {tamanos.map(([ml, t]) => (
          <div key={ml} className="flex min-w-0 flex-col justify-center rounded-xl border border-foreground/10 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
              {ml ? `${formatQuantity(ml)} ml` : "Sin botella"}
            </p>
            <Cantidad pallets={t.pallets} cajas={t.cajas} apilada />
          </div>
        ))}
      </div>

      {/* En columnas y no en grilla: las marcas tienen de uno a seis formatos, y en una grilla las
          chicas se estiraban al alto de la más grande y quedaban medio vacías. */}
      <div className="gap-3 md:columns-2 xl:columns-3">
        {lista.map((marca) => (
          <section
            key={marca.clave}
            className="mb-3 flex min-w-0 break-inside-avoid flex-col rounded-xl border border-foreground/10 bg-background p-4 shadow-sm"
          >
            <div className="mb-3 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-foreground/80">
                <Layers size={20} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold leading-snug">{marca.nombre}</h3>
                <p className="text-xs text-foreground/50">{marca.aceite}</p>
              </div>
              <div className="shrink-0 text-right">
                <Cantidad pallets={marca.pallets} cajas={marca.cajas} apilada />
              </div>
            </div>

            <div className="space-y-3">
              {marca.grupos.map((grupo) => (
                <div key={grupo.clave}>
                  <h4 className="border-b border-foreground/10 pb-1 text-xs font-semibold uppercase tracking-wide text-foreground/50">
                    {grupo.porCaja ? `${grupo.porCaja} × ` : ""}
                    {formatQuantity(grupo.ml)} ml
                  </h4>
                  <div className="divide-y divide-foreground/5">
                    {grupo.formatos.map((f) => (
                      <Link
                        key={f.product.id}
                        href={`/produccion/${f.product.slug}`}
                        className="group -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-foreground/[0.04]"
                      >
                        <span className="min-w-0 truncate text-foreground/70">
                          {f.product.boxesPerPallet ? `Pallet de ${f.product.boxesPerPallet} cajas` : f.product.presentation}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Cantidad pallets={f.pallets} cajas={f.cajas} />
                          <ChevronRight size={14} className="text-foreground/25 group-hover:text-foreground/60" />
                        </span>
                      </Link>
                    ))}
                    {(grupo.sueltas !== 0 || grupo.botellas !== 0) && (
                      <div className="flex items-center justify-between gap-3 py-1.5 pr-[18px] text-sm">
                        <span className="min-w-0 truncate text-foreground/50">Cajas sueltas</span>
                        <span className="shrink-0 whitespace-nowrap text-right tabular-nums">
                          {grupo.sueltas !== 0 && (
                            <span className={`font-semibold ${rojo(grupo.sueltas)}`}>
                              {plural(grupo.sueltas, "caja", "cajas")}
                            </span>
                          )}
                          {grupo.botellas !== 0 && (
                            <span className={`ml-1 text-xs text-foreground/50 ${rojo(grupo.botellas)}`}>
                              {grupo.sueltas !== 0 ? "+ " : ""}
                              {plural(grupo.botellas, "botella", "botellas")}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
