import Link from "next/link";
import type { Caja, Prisma, Product } from "@prisma/client";
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
 * El producto terminado en un cuadro: una fila por marca y aceite, una columna por tamaño de
 * botella, y los totales abajo y a la derecha. En cada casillero, los pallets de cada formato (con
 * su "105 × 12" abajo) y las cajas sueltas de esa caja.
 *
 * Antes fue una tabla de una fila por formato, donde no se veía el total y se perdía el renglón, y
 * después tarjetas por marca, donde el formato quedaba escondido y las tarjetas se escalonaban. El
 * cuadro responde las dos preguntas de todos los días —cuántos pallets hay en total y cuántos de
 * 900— sin buscar, y con cuatro tamaños entra en una pantalla.
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

  // Una celda del cuadro: los formatos de esa marca con botellas de ese tamaño, y sus cajas sueltas.
  const celda = (marca: Marca, ml: number) => marca.grupos.filter((g) => g.ml === ml);
  const borde = "border-l border-foreground/10";
  // La columna de la marca queda fija al deslizar el cuadro en el celular; una sombra de un pixel
  // la separa, porque el borde de una celda fija no se queda con ella.
  const fija = "sticky left-0 z-10 shadow-[1px_0_0_0_color-mix(in_srgb,var(--foreground)_12%,transparent)]";

  return (
    <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-foreground/10 text-xs font-semibold uppercase tracking-wide text-foreground/50">
            <th className={`${fija} bg-background px-4 py-3 text-left`}>Marca</th>
            {tamanos.map(([ml]) => (
              <th key={ml} className={`${borde} px-4 py-3 text-right`}>
                {ml ? `${formatQuantity(ml)} ml` : "Sin botella"}
              </th>
            ))}
            <th className="border-l-2 border-foreground/15 bg-primary/10 px-4 py-3 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((marca) => (
            <tr key={marca.clave} className="group border-b border-foreground/5 align-top">
              <td className={`${fija} bg-background px-4 py-3 transition-colors group-hover:bg-[color-mix(in_srgb,var(--foreground)_3%,var(--background))]`}>
                <p className="font-semibold leading-snug">{marca.nombre}</p>
                <p className="text-xs text-foreground/50">{marca.aceite}</p>
              </td>
              {tamanos.map(([ml]) => {
                const grupos = celda(marca, ml);
                return (
                  <td key={ml} className={`${borde} px-4 py-3 text-right transition-colors group-hover:bg-foreground/[0.03]`}>
                    {grupos.length === 0 ? (
                      <span className="text-foreground/25">—</span>
                    ) : (
                      <div className="flex flex-col items-end gap-2">
                        {grupos.map((grupo) => (
                          <div key={grupo.clave} className="flex flex-col items-end gap-1.5">
                            {grupo.formatos.map((f) => (
                              <Link
                                key={f.product.id}
                                href={`/produccion/${f.product.slug}`}
                                title={`${f.product.name} ${f.product.oilType} ${f.product.presentation}`}
                                className="flex flex-col items-end rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-primary/15"
                              >
                                <Cantidad pallets={f.pallets} cajas={f.cajas} />
                                <span className="mt-0.5 rounded bg-foreground/[0.06] px-1.5 text-xs font-medium tabular-nums text-foreground/70">
                                  {f.product.boxesPerPallet && f.product.unitsPerBox
                                    ? `${f.product.boxesPerPallet} × ${f.product.unitsPerBox}`
                                    : f.product.presentation}
                                </span>
                              </Link>
                            ))}
                            {(grupo.sueltas !== 0 || grupo.botellas !== 0) && (
                              <span className="whitespace-nowrap text-xs tabular-nums text-foreground/60">
                                {grupo.sueltas !== 0 && (
                                  <span className={rojo(grupo.sueltas)}>
                                    + {plural(grupo.sueltas, "caja suelta", "cajas sueltas")}
                                  </span>
                                )}
                                {grupo.botellas !== 0 && (
                                  <span className={`block ${rojo(grupo.botellas)}`}>
                                    + {plural(grupo.botellas, "botella", "botellas")}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
              <td className="border-l-2 border-foreground/15 bg-primary/10 px-4 py-3 text-right">
                <Cantidad pallets={marca.pallets} cajas={marca.cajas} apilada />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-foreground/15 bg-primary/10 align-top">
            <th className={`${fija} bg-[color-mix(in_srgb,var(--primary)_10%,var(--background))] px-4 py-3 text-left font-semibold`}>
              {buscando ? "Total de la búsqueda" : "Total"}
            </th>
            {tamanos.map(([ml, t]) => (
              <td key={ml} className={`${borde} px-4 py-3 text-right`}>
                <Cantidad pallets={t.pallets} cajas={t.cajas} apilada />
              </td>
            ))}
            <td className="border-l-2 border-foreground/15 bg-primary/20 px-4 py-3 text-right">
              <Cantidad pallets={total.pallets} cajas={total.cajas} grande apilada />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
