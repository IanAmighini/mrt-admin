/**
 * Tamaño con el que se ordenan los insumos de una misma categoría, de menor a mayor, en vez de
 * alfabéticamente. Los nombres no siguen una sola convención: los envases y etiquetas terminan en
 * "850ml", las cajas en "12x900" y las tapas llevan la boca en milímetros ("29mm"). Sin contemplar
 * los tres casos, cajas y tapas caen en orden alfabético y queda "Caja Lisa 12x1500" antes que
 * "Caja Lisa 12x900".
 */
export function extractItemSize(name: string): number | null {
  const ml = name.match(/(\d+)\s*ml/i);
  if (ml) return parseInt(ml[1], 10);
  const porCaja = name.match(/\d+x(\d+)\s*$/);
  if (porCaja) return parseInt(porCaja[1], 10);
  const mm = name.match(/(\d+)\s*mm/i);
  if (mm) return parseInt(mm[1], 10);
  return null;
}

/** Comparador para `Array.sort` — pensado para insumos que ya están agrupados por categoría. */
export function compareItemsBySize(a: { name: string }, b: { name: string }): number {
  const sizeA = extractItemSize(a.name);
  const sizeB = extractItemSize(b.name);
  if (sizeA !== null && sizeB !== null && sizeA !== sizeB) return sizeA - sizeB;
  if (sizeA !== null && sizeB === null) return -1;
  if (sizeA === null && sizeB !== null) return 1;
  return a.name.localeCompare(b.name);
}
