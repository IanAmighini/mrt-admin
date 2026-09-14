import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { periodFromSearchParams, periodLastDay, toDateInputValue } from "@/lib/period";
import { getLibroIva } from "@/lib/libro-iva";
import { libroIvaSheets } from "@/lib/reports-excel";
import { buildWorkbook, excelResponse } from "@/lib/excel";

/**
 * El Excel que se le pasa al contador. El chequeo de rol se repite acá porque un Route Handler no
 * ejecuta el layout, y el del proxy sale de NAV_ITEMS por prefijo.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "SOLO_LECTURA" && user.role !== "SECRETARIA") {
    return new Response("Sin permisos para ver el libro de IVA", { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const { period } = periodFromSearchParams({
    preset: sp.get("preset") ?? "mes",
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });

  const libro = await getLibroIva(period);
  const workbook = await buildWorkbook(libroIvaSheets(libro));
  const desde = toDateInputValue(period.from);
  const hasta = toDateInputValue(periodLastDay(period));
  return excelResponse(workbook, `libro_iva_${desde}_${hasta}.xlsx`);
}
