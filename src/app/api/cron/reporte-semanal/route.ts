import { isValidCronRequest } from "@/lib/cron-auth";
import { sendWeeklyReport } from "@/lib/weekly-report";

/**
 * Envío del resumen semanal, disparado por Vercel Cron los lunes.
 *
 * El horario vive en vercel.json como `0 11 * * 1`: Vercel agenda siempre en UTC, y como Argentina
 * es UTC-3 todo el año (no hay horario de verano), eso son las 08:00 locales y no se corre nunca.
 * En el plan Hobby dispara en algún momento dentro de esa hora, no a las 8 en punto.
 *
 * Vive fuera de `(app)` y fuera del middleware a propósito, que es lo contrario de lo que hacen
 * las rutas de export: aquellas cuelgan de su página para heredar el gate de rol, y esta no puede
 * pasar por el middleware porque la llama un job sin sesión. Si el middleware la redirigiera al
 * login, el trabajo **desaparecería sin dejar rastro** — Vercel Cron no sigue redirects ni los
 * registra. Ver el comentario del matcher en src/proxy.ts.
 *
 * Se autentica con `Authorization: Bearer <CRON_SECRET>`, que Vercel inyecta solo. El mismo header
 * sirve para dispararlo a mano con curl y comprobar la cadena entera sin esperar al lunes.
 */
export async function GET(request: Request) {
  if (!isValidCronRequest(request)) {
    return new Response("No autorizado", { status: 401 });
  }

  try {
    const resultado = await sendWeeklyReport();
    // Cuerpo corto para poder leer el resultado desde el log del cron sin abrir el mail.
    return Response.json({
      ok: true,
      enviado: resultado.enviado,
      ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
      destinatarios: resultado.destinatarios.length,
      semana: resultado.semana,
    });
  } catch (error) {
    // Devolver 500 es lo que hace que la corrida figure como fallida en el log de Vercel; si se
    // tragara el error, un lunes sin mail parecería un lunes exitoso.
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    return new Response(`Falló el envío del reporte semanal: ${mensaje}`, { status: 500 });
  }
}
