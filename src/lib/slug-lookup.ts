import "server-only";

const CUID_RE = /^c[a-z0-9]{24}$/;

/**
 * Busca por slug (link canónico) y, si no aparece, por id (link viejo/bookmarkeado) — solo
 * cuando el param tiene forma de cuid, para no gastar una consulta extra en 404s comunes.
 */
export async function findBySlugOrId<T>(
  bySlug: () => Promise<T | null>,
  byId: (id: string) => Promise<T | null>,
  param: string
): Promise<T | null> {
  const bySlugResult = await bySlug();
  if (bySlugResult) return bySlugResult;
  return CUID_RE.test(param) ? byId(param) : null;
}

/**
 * Cómo se busca un cliente o proveedor por el slug del link: el actual y, si no, uno que tuvo antes
 * de que le cambiaran el nombre. La página después redirige al actual.
 */
export function slugDeEntidad(slug: string) {
  return { OR: [{ slug }, { slugsAnteriores: { has: slug } }] };
}
