import "server-only";
import { timingSafeEqual } from "crypto";

/**
 * Valida el header `Authorization: Bearer <CRON_SECRET>` con el que Vercel Cron llama a las rutas
 * agendadas (inyecta el header solo, a partir de la variable de entorno del proyecto).
 *
 * Falla cerrado: si `CRON_SECRET` no está configurada, no se autoriza a nadie. Un endpoint que
 * dispara mails no puede quedar abierto por un olvido de configuración.
 *
 * La comparación es de tiempo constante más por prolijidad que por necesidad — con un secreto
 * aleatorio de 32 bytes sobre internet, un ataque de temporización no es una amenaza real — pero
 * son cuatro líneas y saca el tema de la discusión.
 */
export function isValidCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header) return false;

  const expected = `Bearer ${secret}`;
  const received = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);

  // timingSafeEqual tira si los largos no coinciden, así que se compara antes.
  if (received.length !== expectedBuffer.length) return false;
  return timingSafeEqual(received, expectedBuffer);
}
