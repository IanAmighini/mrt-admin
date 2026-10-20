import { Prisma } from "@prisma/client";
import type { FormaDeSueldo } from "@prisma/client";

/**
 * La cuenta de un renglón de la planilla de sueldos. Es la misma en el navegador —que la muestra
 * mientras Adriana carga las horas— y en el servidor —que la graba al cerrar la semana—: si fueran
 * dos, la planilla diría un número y el gasto otro.
 *
 * Es la cuenta de la planilla de Excel:
 * - el valor hora es el jornal ÷ 8;
 * - el sueldo es horas × valor hora, más un 50% del valor hora por cada hora trabajada en feriado
 *   (esas horas ya están dentro de las horas totales);
 * - de ahí se descuenta lo que ya cobró: lo transferido en la Cuenta 1 (el sueldo por banco de
 *   Alex) y lo que tiene a cuenta en la Cuenta 2 (un adelanto, un cliente que le pagó directo);
 * - lo que queda se le da en efectivo, redondeado para arriba. Esos pesos de más **no** se le
 *   descuentan la semana siguiente: son gasto.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);
const max0 = (v: Prisma.Decimal) => (v.isNegative() ? ZERO : v);
const min = (a: Prisma.Decimal, b: Prisma.Decimal) => (a.lessThan(b) ? a : b);

export const HORAS_POR_JORNAL = 8;
export const RECARGO_FERIADO = D("0.5");
/** El redondeo que sugiere la app: para arriba, a los $ 50. Adriana lo cambia según los billetes. */
export const REDONDEO_SUGERIDO = 50;

export function valorHora(jornal: Prisma.Decimal): Prisma.Decimal {
  return jornal.dividedBy(HORAS_POR_JORNAL);
}

/** Lo que ganó en el período, antes de descontar nada. */
export function sueldoDelPeriodo(
  forma: FormaDeSueldo,
  tarifa: Prisma.Decimal,
  horas: Prisma.Decimal,
  horasFeriado: Prisma.Decimal
): Prisma.Decimal {
  if (forma === "MENSUAL") return tarifa;
  const hora = valorHora(tarifa);
  return horas.times(hora).plus(horasFeriado.times(hora).times(RECARGO_FERIADO)).toDecimalPlaces(2);
}

export function redondearParaArriba(monto: Prisma.Decimal, a = REDONDEO_SUGERIDO): Prisma.Decimal {
  if (!monto.greaterThan(0)) return ZERO;
  return monto.dividedBy(a).ceil().times(a);
}

export type EntradaDelRenglon = {
  forma: FormaDeSueldo;
  tarifa: Prisma.Decimal;
  horas: Prisma.Decimal;
  horasFeriado: Prisma.Decimal;
  /**
   * El saldo de sus dos cuentas sumadas, antes de esta planilla: positivo, se le debe; negativo,
   * tiene a cuenta. Las dos juntas porque la plata es una sola: si un cobro directo de un cliente
   * cayó en la Cuenta 1, igual ya lo cobró.
   */
  saldoAnterior: Prisma.Decimal;
  /**
   * El sueldo en la Cuenta 1 (el recibo de Alex, cargado como gasto en su Cuenta 1) que todavía no
   * se descontó de ninguna semana. Ya es gasto allá, así que acá se resta del gasto de la semana;
   * y lo que se le transfirió por banco ya está en `saldoAnterior`, así que también se le paga menos.
   */
  pendienteCuenta1: Prisma.Decimal;
  /** Lo que se escribió a mano; null sigue a lo sugerido. */
  descuentoCuenta1: Prisma.Decimal | null;
  descuentoACuenta: Prisma.Decimal | null;
  pagado: Prisma.Decimal | null;
};

export type CuentaDelRenglon = {
  sueldo: Prisma.Decimal;
  /** Se le debía de antes (una semana que se le pagó de menos): se suma a lo de esta. */
  deudaAnterior: Prisma.Decimal;
  /** Lo que tiene a cuenta: adelantos, lo que le pagó un cliente directo. */
  aCuenta: Prisma.Decimal;
  descuentoCuenta1: Prisma.Decimal;
  descuentoACuenta: Prisma.Decimal;
  /** Lo que se le debe después de los descuentos. */
  aPagar: Prisma.Decimal;
  pagadoSugerido: Prisma.Decimal;
  pagado: Prisma.Decimal;
  /** Los pesos de más del redondeo, que son gasto. */
  redondeo: Prisma.Decimal;
  /** El gasto de sueldo de esta semana en la Cuenta 2: lo ganado, menos lo que ya es gasto en la 1. */
  gasto: Prisma.Decimal;
  /** Lo que le queda a cuenta después de esta planilla (el resto de un adelanto que va en partes). */
  quedaACuenta: Prisma.Decimal;
  /** Lo que le queda debiendo, si se le dio menos de lo que se le debe. */
  quedaDebiendo: Prisma.Decimal;
};

export function cuentaDelRenglon(e: EntradaDelRenglon): CuentaDelRenglon {
  const sueldo = sueldoDelPeriodo(e.forma, e.tarifa, e.horas, e.horasFeriado);
  const deudaAnterior = max0(e.saldoAnterior);
  const aCuenta = max0(e.saldoAnterior.negated());

  // Lo de la Cuenta 1 se descuenta hasta lo que ganó: más que eso ya no es sueldo de esta semana.
  const descuentoCuenta1 = min(max0(e.descuentoCuenta1 ?? min(e.pendienteCuenta1, sueldo)), sueldo);
  const debidoAntesDelACuenta = sueldo.minus(descuentoCuenta1).plus(deudaAnterior);
  // Lo que tiene a cuenta, todo salvo que se diga otra cosa (un adelanto que se descuenta en partes),
  // y nunca más de lo que se le debe.
  const descuentoACuenta = min(max0(e.descuentoACuenta ?? aCuenta), min(aCuenta, max0(debidoAntesDelACuenta)));
  const aPagar = debidoAntesDelACuenta.minus(descuentoACuenta);
  const pagadoSugerido = redondearParaArriba(aPagar);
  const pagado = max0(e.pagado ?? pagadoSugerido);
  const redondeo = max0(pagado.minus(aPagar));
  const gasto = sueldo.minus(descuentoCuenta1).plus(redondeo);

  return {
    sueldo,
    deudaAnterior,
    aCuenta,
    descuentoCuenta1,
    descuentoACuenta,
    aPagar,
    pagadoSugerido,
    pagado,
    redondeo,
    gasto,
    quedaACuenta: aCuenta.minus(descuentoACuenta),
    quedaDebiendo: max0(aPagar.minus(pagado)),
  };
}
