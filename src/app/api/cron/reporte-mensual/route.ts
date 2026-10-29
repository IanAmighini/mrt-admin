import { isValidCronRequest } from "@/lib/cron-auth";
import { sendMonthlyReport } from "@/lib/monthly-report";

/**
 * Envío del cierre del mes, disparado por Vercel Cron el 1° de cada mes por el mes anterior.
 *
 * Igual que el semanal (ver reporte-semanal/route.ts): `0 11 1 * *` en vercel.json son las 08:00 de
 * acá, vive fuera del middleware porque la llama un job sin sesión, y se autentica con el
 * `CRON_SECRET` que inyecta Vercel. Si ya se mandó ese mes, no lo repite.
 */
export async function GET(request: Request) {
  if (!isValidCronRequest(request)) {
    return new Response("No autorizado", { status: 401 });
  }

  try {
    const resultado = await sendMonthlyReport();
    return Response.json({
      ok: true,
      enviado: resultado.enviado,
      ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
      destinatarios: resultado.destinatarios.length,
      mes: resultado.mes,
    });
  } catch (error) {
    // 500 para que figure como fallida en el log de Vercel.
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    return new Response(`Falló el envío del cierre del mes: ${mensaje}`, { status: 500 });
  }
}
