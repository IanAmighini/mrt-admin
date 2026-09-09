const PREFIJO = "USER_ERROR:";

/**
 * Error cuyo mensaje está escrito para que lo lea el usuario ("El nombre es obligatorio", "Ya
 * existe la marca X").
 *
 * Hace falta una clase aparte por cómo trata Next.js a los errores que salen de una Server Action:
 * **en producción reemplaza el `message` por uno genérico** para no filtrar detalles del servidor,
 * y el usuario termina viendo "Minified React error #441" en lugar del texto. Lo único que Next
 * deja pasar tal cual al cliente es el `digest`, así que el mensaje viaja ahí.
 *
 * La separación además es la correcta y no solo una gambeta: lo que se tira con `UserError` es lo
 * que se decidió mostrar, y cualquier otra excepción (una falla de Prisma, un bug) sigue llegando
 * genérica, que es lo que se quiere.
 *
 * En desarrollo el `message` llega entero, así que `userErrorMessage` sirve en los dos entornos.
 */
export class UserError extends Error {
  digest: string;

  constructor(message: string) {
    super(message);
    this.name = "UserError";
    this.digest = PREFIJO + message;
  }
}

/**
 * Texto a mostrar por un error que volvió de una Server Action. Usar siempre esto en vez de
 * `e.message`, que en producción es el "Minified React error #441" para cualquier error.
 */
export function userErrorMessage(e: unknown, fallback = "Ocurrió un error."): string {
  if (typeof e === "object" && e !== null) {
    const { digest } = e as { digest?: unknown };
    if (typeof digest === "string" && digest.startsWith(PREFIJO)) {
      return digest.slice(PREFIJO.length);
    }
  }
  // En desarrollo no hay sanitización y el mensaje real llega en `message`.
  if (e instanceof Error && e.message && !e.message.startsWith("Minified React error")) {
    return e.message;
  }
  return fallback;
}

/**
 * Si el "error" es en realidad la señal con la que Next implementa `redirect()` o `notFound()`.
 *
 * Los formularios de la app envuelven la acción en un try/catch para mostrar el mensaje, y eso se
 * come la señal: una acción que redirige después de guardar terminaba mostrando "Ocurrió un error"
 * y quedándose en la página. Hay que dejarla pasar.
 */
export function esSenalDeNavegacion(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const { digest } = e as { digest?: unknown };
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}
