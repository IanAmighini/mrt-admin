import { Prisma, type Currency } from "@prisma/client";
import { UserError } from "@/lib/user-error";
import { parseNumeroEscrito } from "@/lib/money";

const NOMBRE: Record<Currency, string> = { ARS: "pesos", USD: "dólares" };

/**
 * Pasa lo que se escribió a la moneda de la cuenta.
 *
 * **Todo se guarda en la moneda de la cuenta, siempre.** El saldo suma los comprobantes sin mirar
 * de qué moneda son, así que una nota en pesos dentro de la cuenta de Cristian —que se lleva en
 * dólares— sumaba sus pesos como si fueran dólares. Antes cada formulario tenía un desplegable de
 * moneda que decía en qué se *guardaba*; ahora dice en qué se *escribió*, y si no es la de la cuenta
 * hace falta la cotización para convertir.
 *
 * Devuelve la función que convierte un monto y la cotización a guardar en el comprobante, que es con
 * la que después se puede reconstruir lo que se escribió.
 */
export function aLaMonedaDeLaCuenta(
  escrita: Currency,
  cuenta: Currency,
  cotizacion: Prisma.Decimal | null
): { convertir: (monto: Prisma.Decimal) => Prisma.Decimal; exchangeRate: Prisma.Decimal | null } {
  if (escrita === cuenta) return { convertir: (m) => m, exchangeRate: cotizacion };
  if (!cotizacion || !cotizacion.greaterThan(0)) {
    throw new UserError(
      `Los montos están en ${NOMBRE[escrita]} y la cuenta se lleva en ${NOMBRE[cuenta]}: cargá la cotización para convertirlos.`
    );
  }
  return {
    convertir: (m) => (cuenta === "USD" ? m.dividedBy(cotizacion) : m.times(cotizacion)).toDecimalPlaces(2),
    exchangeRate: cotizacion,
  };
}

/** Lee la moneda en que se escribieron los montos; si el formulario no la manda, es la de la cuenta. */
export function monedaEscrita(raw: FormDataEntryValue | null, cuenta: Currency): Currency {
  const valor = String(raw || "");
  return valor === "ARS" || valor === "USD" ? valor : cuenta;
}

/** La cotización del formulario, bien leída: "1.523" son mil quinientos veintitrés, no 1,523. */
export function leerCotizacion(raw: FormDataEntryValue | null): Prisma.Decimal | null {
  const valor = String(raw || "").trim();
  if (!valor) return null;
  const cotizacion = parseNumeroEscrito(valor, "cotización");
  if (!cotizacion.greaterThan(0)) throw new UserError("La cotización tiene que ser mayor a cero.");
  return cotizacion;
}

/**
 * Convierte todos los montos de un desglose o de unos totales, dejando quietas las alícuotas: un 21%
 * es 21% en cualquier moneda.
 */
export function convertirMontos<T extends Record<string, unknown>>(
  obj: T,
  convertir: (m: Prisma.Decimal) => Prisma.Decimal
): T {
  const NO_SON_MONTOS = new Set(["rate", "ivaRate"]);
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, v instanceof Prisma.Decimal && !NO_SON_MONTOS.has(k) ? convertir(v) : v])
  ) as T;
}
