import { Prisma } from "@prisma/client";

/**
 * Cuántos kilos pesa un litro de aceite. El aceite entra pesado —el ticket de la balanza dice
 * kilos— y se envasa en litros, así que los kilos se dividen por esto.
 *
 * Es un número fijo y no un campo del formulario a propósito: cuando se pedía "factor de
 * conversión" en cada ingreso, una vez se escribieron los kilos en los dos casilleros y entraron
 * 789 millones de litros. Lo único que hay que tipear es lo que dice el ticket.
 */
export const DENSIDAD_ACEITE = new Prisma.Decimal("0.92");

/** El divisor como se escribe en pantalla: "0,92". */
export const DENSIDAD_TEXTO = DENSIDAD_ACEITE.toString().replace(".", ",");

/** Los litros que son estos kilos de aceite. */
export function litrosDeKilos(kilos: Prisma.Decimal): Prisma.Decimal {
  return kilos.dividedBy(DENSIDAD_ACEITE);
}
