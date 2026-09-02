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
