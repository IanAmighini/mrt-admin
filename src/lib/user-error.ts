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
