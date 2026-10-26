import { Prisma } from "@prisma/client";
import type { FormaDeSueldo } from "@prisma/client";

/**
 * La cuenta de un renglón de la planilla de sueldos. Es la misma en el navegador —que la muestra
 * mientras Adriana carga las horas— y en el servidor —que la graba al cerrar la semana—: si fueran
 * dos, la planilla diría un número y el gasto otro.
 *
 * El arreglo con los chicos (26/10/2026):
 * - las horas de la semana van al valor hora, que es el jornal ÷ 8;
 * - las horas trabajadas en feriado van al valor hora más 0,5 (están dentro de las horas totales,
 *   así que acá se suma sólo ese medio extra);
 * - un **bono de un jornal por presentismo** y otro de un jornal **por puntualidad**, cada uno si
 *   corresponde esa semana;
 * - de ahí se descuenta lo que ya cobró a cuenta (un adelanto, un cliente que le pagó directo);
 * - lo que queda se le da en efectivo, redondeado para arriba. Esos pesos de más **no** se le
 *   descuentan la semana siguiente: son gasto.
 *
 * El sueldo que Alex cobra en la Cuenta 1 es su bono —lo que antes Pedro le daba por fuera— y no se
 * descuenta de la semana: es un gasto y un pago aparte, en su Cuenta 1.
 *
 * Por mes (Adriana): el sueldo del mes más lo que paga de monotributo, que se le reintegra.
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

export function redondearParaArriba(monto: Prisma.Decimal, a = REDONDEO_SUGERIDO): Prisma.Decimal {
  if (!monto.greaterThan(0)) return ZERO;
  return monto.dividedBy(a).ceil().times(a);
}

export type EntradaDelRenglon = {
  forma: FormaDeSueldo;
  /** El jornal (por semana) o el sueldo del mes. */
  tarifa: Prisma.Decimal;
  horas: Prisma.Decimal;
  /** Las horas en feriado, que ya están dentro de `horas`: suman medio valor hora más cada una. */
  horasFeriado: Prisma.Decimal;
  presentismo: boolean;
  puntualidad: boolean;
  /** Por mes: lo que paga de monotributo, que se le suma al sueldo. */
  monotributo: Prisma.Decimal;
  /**
   * El saldo de su Cuenta 2 antes de esta planilla: positivo, se le debe; negativo, tiene a cuenta.
   * La Cuenta 1 no entra: ahí va el bono de Alex, que se carga y se paga aparte.
   */
  saldoAnterior: Prisma.Decimal;
  /** Lo que se escribió a mano; null sigue a lo sugerido. */
  descuentoACuenta: Prisma.Decimal | null;
  pagado: Prisma.Decimal | null;
};

export type CuentaDelRenglon = {
  /** Horas × valor hora. */
  porHoras: Prisma.Decimal;
  /** El medio valor hora extra de las horas en feriado. */
  porFeriado: Prisma.Decimal;
  /** Los bonos de presentismo y puntualidad: un jornal cada uno. */
  bonos: Prisma.Decimal;
  monotributo: Prisma.Decimal;
  /** Lo que ganó en el período, antes de descontar nada. */
  sueldo: Prisma.Decimal;
  /** Se le debía de antes (una semana que se le pagó de menos): se suma a lo de esta. */
  deudaAnterior: Prisma.Decimal;
  /** Lo que tiene a cuenta: adelantos, lo que le pagó un cliente directo. */
  aCuenta: Prisma.Decimal;
  descuentoACuenta: Prisma.Decimal;
  /** Lo que se le debe después de los descuentos. */
  aPagar: Prisma.Decimal;
  pagadoSugerido: Prisma.Decimal;
  pagado: Prisma.Decimal;
  /** Los pesos de más del redondeo, que son gasto. */
  redondeo: Prisma.Decimal;
  /** El gasto de sueldo del período: lo ganado más el redondeo. */
  gasto: Prisma.Decimal;
  /** Lo que le queda a cuenta después de esta planilla (el resto de un adelanto que va en partes). */
  quedaACuenta: Prisma.Decimal;
  /** Lo que le queda debiendo, si se le dio menos de lo que se le debe. */
  quedaDebiendo: Prisma.Decimal;
};

export function cuentaDelRenglon(e: EntradaDelRenglon): CuentaDelRenglon {
  let porHoras = ZERO;
  let porFeriado = ZERO;
  let bonos = ZERO;
  let monotributo = ZERO;
  if (e.forma === "SEMANAL") {
    const hora = valorHora(e.tarifa);
    porHoras = e.horas.times(hora).toDecimalPlaces(2);
    porFeriado = e.horasFeriado.times(hora).times(RECARGO_FERIADO).toDecimalPlaces(2);
    bonos = e.tarifa.times((e.presentismo ? 1 : 0) + (e.puntualidad ? 1 : 0));
  } else {
    porHoras = e.tarifa;
    monotributo = max0(e.monotributo);
  }
  const sueldo = porHoras.plus(porFeriado).plus(bonos).plus(monotributo);

  const deudaAnterior = max0(e.saldoAnterior);
  const aCuenta = max0(e.saldoAnterior.negated());
  const debido = sueldo.plus(deudaAnterior);
  // Lo que tiene a cuenta, todo salvo que se diga otra cosa (un adelanto que se descuenta en partes),
  // y nunca más de lo que se le debe.
  const descuentoACuenta = min(max0(e.descuentoACuenta ?? aCuenta), min(aCuenta, debido));
  const aPagar = debido.minus(descuentoACuenta);
  const pagadoSugerido = redondearParaArriba(aPagar);
  const pagado = max0(e.pagado ?? pagadoSugerido);
  const redondeo = max0(pagado.minus(aPagar));

  return {
    porHoras,
    porFeriado,
    bonos,
    monotributo,
    sueldo,
    deudaAnterior,
    aCuenta,
    descuentoACuenta,
    aPagar,
    pagadoSugerido,
    pagado,
    redondeo,
    gasto: sueldo.plus(redondeo),
    quedaACuenta: aCuenta.minus(descuentoACuenta),
    quedaDebiendo: max0(aPagar.minus(pagado)),
  };
}
