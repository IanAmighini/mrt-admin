/** Convierte un nombre en un slug kebab-case ASCII: saca tildes/diacríticos, pasa a minúsculas,
 * reemplaza todo lo que no sea [a-z0-9] por guiones, colapsa y recorta guiones. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Genera un slug único agregando -2, -3, ... ante colisión. `exists` decide colisión (una query
 * contra la tabla correspondiente, típicamente dentro de la misma transacción que la creación) —
 * se mantiene desacoplado de los tipos de Prisma así sirve igual para Entity/Item/Product.
 */
export async function generateUniqueSlug(
  name: string,
  exists: (candidate: string) => Promise<boolean>,
  fallbackBase: string
): Promise<string> {
  const base = slugify(name) || fallbackBase;
  let candidate = base;
  let n = 2;
  while (await exists(candidate)) {
    candidate = `${base}-${n}`;
    n++;
  }
  return candidate;
}
