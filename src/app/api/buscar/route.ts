import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { searchAll } from "@/lib/search";

/** Tope de largo: evita que pegar un párrafo dispare cuatro ILIKE '%…%' contra tablas sin índice. */
const MAX_TERM_LENGTH = 100;

/**
 * Buscador global. Devuelve JSON (no HTML) para que lo consuma la paleta desde el cliente.
 *
 * Va bajo /api a propósito: ningún href de NAV_ITEMS es prefijo suyo, así que el middleware le
 * aplica el chequeo de sesión pero ningún gate de rol — la búsqueda la puede usar cualquier rol, y
 * el filtrado por rol que sí corresponde (tesorerías) vive adentro de searchAll.
 *
 * Se usa getCurrentUser y no requireUser: requireUser redirige al login, y un redirect acá haría
 * que el fetch del cliente reciba el HTML del login y explote al parsearlo.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ results: [] }, { status: 401 });

  const term = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (term.length < 2 || term.length > MAX_TERM_LENGTH) {
    return Response.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const results = await searchAll(term, user.role);

  // Depende del usuario y del rol, y cambia con cada tecla: no se cachea en ningún lado.
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
