import "server-only";
import type { Prisma, SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { UserError } from "@/lib/user-error";
import { insumosDeRecetaPorNombre, plantillaDeReceta } from "@/lib/recipe-template";

export type LineaDeReceta = {
  itemId: string;
  nombre: string;
  categoria: SupplierCategory;
  unidad: string;
  cantidad: Prisma.Decimal;
};

export type RecetaDeCombinacion = {
  marcaId: string;
  formatoId: string;
  /** El producto, si ya existe. Si no, se crea solo la primera vez que se produce o se pide. */
  producto: { id: string; slug: string } | null;
  /**
   * `true` si es la que tiene guardada el producto —la que se descuenta al producir, y la que el
   * admin puede haber cambiado—. `false` si todavía no tiene y es la que se va a armar sola.
   */
  guardada: boolean;
  lineas: LineaDeReceta[];
  /** Por qué no se puede armar sola: el insumo que falta cargar. */
  falta: string | null;
  /** La guardada no es igual a la que se armaría sola: alguien la cambió a mano. */
  cambiadaAMano: boolean;
};

export const claveDeCombinacion = (marcaId: string, formatoId: string) => `${marcaId}|${formatoId}`;

/**
 * La receta de cada marca × formato, tal como se va a usar al producir: la que tiene guardada el
 * producto si ya existe, o la que se armaría sola si todavía no. Todo con cinco consultas, sin
 * importar cuántas combinaciones haya.
 */
export async function getRecetasPorCombinacion(): Promise<Map<string, RecetaDeCombinacion>> {
  const [marcas, formatos, productos, porNombre, eficiencia] = await Promise.all([
    prisma.marca.findMany(),
    prisma.formato.findMany(),
    prisma.product.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        oilType: true,
        presentation: true,
        recipe: { include: { item: { select: { id: true, name: true, category: true, unit: true } } } },
      },
    }),
    insumosDeRecetaPorNombre(prisma),
    getSetting("oilFillEfficiencyPercent", "100"),
  ]);
  const nombres = new Map([...porNombre.values()].map((i) => [i.id, i]));
  const productoDe = new Map(productos.map((p) => [`${p.name}|${p.oilType}|${p.presentation}`, p]));

  const recetas = new Map<string, RecetaDeCombinacion>();
  for (const marca of marcas) {
    for (const formato of formatos) {
      const producto = productoDe.get(`${marca.name}|${marca.oilType}|${formato.presentation}`) ?? null;
      const base = {
        marcaId: marca.id,
        formatoId: formato.id,
        producto: producto && { id: producto.id, slug: producto.slug },
      };
      let automatica: LineaDeReceta[] | null = null;
      let falta: string | null = null;
      try {
        automatica = plantillaDeReceta(marca, formato, Number(eficiencia), porNombre).map((l) => {
          const item = nombres.get(l.itemId)!;
          return { itemId: l.itemId, nombre: item.name, categoria: item.category, unidad: item.unit, cantidad: l.quantityPerUnit };
        });
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        falta = e.message;
      }

      const clave = claveDeCombinacion(marca.id, formato.id);
      if (producto && producto.recipe.length > 0) {
        const lineas = producto.recipe.map((r) => ({
          itemId: r.itemId,
          nombre: r.item.name,
          categoria: r.item.category,
          unidad: r.item.unit,
          cantidad: r.quantityPerUnit,
        }));
        recetas.set(clave, { ...base, guardada: true, falta: null, lineas, cambiadaAMano: !mismasLineas(lineas, automatica) });
      } else {
        recetas.set(clave, { ...base, guardada: false, falta, lineas: automatica ?? [], cambiadaAMano: false });
      }
    }
  }
  return recetas;
}

/** Mismos insumos y mismas cantidades, con la precisión con que se guardan (4 decimales). */
function mismasLineas(a: LineaDeReceta[], b: LineaDeReceta[] | null) {
  if (!b || a.length !== b.length) return false;
  const firma = (l: LineaDeReceta[]) =>
    l
      .map((x) => `${x.itemId}:${x.cantidad.toFixed(4)}`)
      .sort()
      .join("|");
  return firma(a) === firma(b);
}

/** El orden en que se leen las líneas de una receta: como se arma el pallet. */
export const ORDEN_DE_RECETA: SupplierCategory[] = [
  "ACEITE",
  "ENVASES",
  "TAPAS",
  "ETIQUETAS",
  "CAJAS",
  "PALLET_NORMALIZADO",
];

export function ordenarLineas<T extends { categoria: SupplierCategory; nombre: string }>(lineas: T[]): T[] {
  const pos = (c: SupplierCategory) => {
    const i = ORDEN_DE_RECETA.indexOf(c);
    return i === -1 ? ORDEN_DE_RECETA.length : i;
  };
  return [...lineas].sort((a, b) => pos(a.categoria) - pos(b.categoria) || a.nombre.localeCompare(b.nombre));
}
