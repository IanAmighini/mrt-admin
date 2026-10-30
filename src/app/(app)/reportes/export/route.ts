import type { NextRequest } from "next/server";
import type { Circuit } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth-helpers";
import { CIRCUIT_BY_SLUG } from "@/lib/labels";
import { hoyComoFecha, periodFromSearchParams } from "@/lib/period";
import {
  getCobranzasReport,
  getComprasReport,
  getGastosReport,
  getResultadoReport,
  getCostoBotellaReport,
  getInsumosMinimoReport,
  getCierreReport,
  getValorizacionReport,
  getProduccionReport,
  getStockReport,
  getVencidosReport,
  getVentasReport,
  isReportKey,
} from "@/lib/reports";
import { buildReportSheets, reportFilename, type ReportData } from "@/lib/reports-excel";
import { buildWorkbook, excelResponse } from "@/lib/excel";

/**
 * Descarga de un reporte en Excel. Cuelga de /reportes a propósito: así el middleware le aplica
 * el mismo gate de rol que a la página (resuelve permisos por prefijo contra NAV_ITEMS). El
 * chequeo igual se repite acá porque los Route Handlers no ejecutan el layout.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  if (user.role !== "ADMIN" && user.role !== "SOLO_LECTURA") {
    return new Response("Sin permisos para ver reportes", { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  // "Resultado del mes" se unió al Cierre del mes: un link viejo baja el cierre.
  const key = sp.get("report") === "resultado" ? "cierre-mes" : (sp.get("report") ?? undefined);
  if (!isReportKey(key)) return new Response("Reporte inválido", { status: 400 });

  const { period } = periodFromSearchParams({
    preset: sp.get("preset") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });

  const circuitSlug = sp.get("circuit");
  const circuit: Circuit | undefined = circuitSlug ? CIRCUIT_BY_SLUG[circuitSlug] : undefined;

  let asOf = new Date();
  let data: ReportData;

  switch (key) {
    case "remitos-vencidos":
      data = { key, report: await getVencidosReport({ asOf, circuit }) };
      break;
    case "insumos-bajo-minimo":
      data = { key, report: await getInsumosMinimoReport({ asOf }) };
      break;
    case "valorizacion-insumos": {
      // Al día que se eligió en la pantalla, o a hoy.
      const al = sp.get("al");
      const hoy = hoyComoFecha();
      const elegido = al && /^\d{4}-\d{2}-\d{2}$/.test(al) ? new Date(`${al}T00:00:00Z`) : null;
      asOf = elegido && !Number.isNaN(elegido.getTime()) && elegido < hoy ? elegido : hoy;
      data = { key, report: await getValorizacionReport({ asOf }) };
      break;
    }
    case "ventas":
      data = { key, report: await getVentasReport(period, { circuit }) };
      break;
    case "cobranzas": {
      const [clientes, proveedores] = await Promise.all([
        getCobranzasReport(period, "CLIENTES"),
        getCobranzasReport(period, "PROVEEDORES"),
      ]);
      data = { key, clientes, proveedores };
      break;
    }
    case "compras":
      data = { key, report: await getComprasReport(period) };
      break;
    case "gastos":
      data = { key, report: await getGastosReport(period) };
      break;
    case "cierre-mes": {
      const [cierre, resultado] = await Promise.all([getCierreReport(period), getResultadoReport(period)]);
      data = { key, report: cierre, resultado };
      break;
    }
    case "costo-botella":
      data = { key, report: await getCostoBotellaReport(period) };
      break;
    case "produccion":
      data = { key, report: await getProduccionReport(period) };
      break;
    case "stock":
      data = { key, report: await getStockReport(period) };
      break;
  }

  const workbook = await buildWorkbook(buildReportSheets(data, asOf));
  return excelResponse(workbook, reportFilename(key, period, asOf));
}
