import type { Currency, Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";

/** Las etiquetas chicas de las filas: medio, cuenta, comprobante. */
export const ETIQUETA =
  "max-w-full truncate whitespace-nowrap rounded-md bg-foreground/[0.05] px-2 py-0.5 text-xs text-foreground/60";
/** La que hay que ver primero: un cobro o pago directo, una cuenta en dólares. */
export const ETIQUETA_DESTACADA =
  "max-w-full truncate whitespace-nowrap rounded-md bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";

/**
 * Si un comprobante ya se pagó o se cobró, o cuánto le falta. Verde cuando está saldado, ámbar
 * cuando no; con lo que falta si ya se pagó una parte.
 */
export function EstadoDePago({
  pendiente,
  total,
  moneda,
  verbo,
}: {
  pendiente: Prisma.Decimal;
  total: Prisma.Decimal;
  moneda: Currency;
  /** "Cobrado" en un cliente, "Pagado" en un proveedor. */
  verbo: "Cobrado" | "Pagado";
}) {
  const saldado = pendiente.lessThan(0.005);
  const parcial = !saldado && pendiente.lessThan(total);
  return (
    <span
      className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${
        saldado
          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      }`}
    >
      {saldado
        ? verbo
        : parcial
          ? `Falta ${verbo === "Cobrado" ? "cobrar" : "pagar"} ${formatMoney(pendiente, moneda)}`
          : `Sin ${verbo === "Cobrado" ? "cobrar" : "pagar"}`}
    </span>
  );
}
