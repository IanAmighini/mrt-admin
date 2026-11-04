import { Prisma } from "@prisma/client";
import { sumDecimals, ZERO } from "@/lib/money";

/** La financiera con la que se trabaja. Se puede cambiar en el formulario. */
export const FINANCIERA_POR_DEFECTO = "Asociación Mutual Junín";

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Cuánto se ganó con los cheques de una financiera: lo que valen de más sobre lo que el cliente le
 * transfirió, en % y a cuántos días. Los días son el promedio hasta la fecha de cobro de cada
 * cheque, pesado por su monto; uno sin fecha es al día.
 *
 * Sin módulo de servidor: el formulario la usa para mostrar la cuenta mientras se carga, y la acción
 * para escribirla en el movimiento, así las dos dicen lo mismo.
 */
export function rendimientoDeFinanciera(params: {
  fecha: Date | null;
  transferencia: Prisma.Decimal;
  cheques: { monto: Prisma.Decimal; fechaCobro: Date | null }[];
}) {
  const total = sumDecimals(params.cheques.map((c) => c.monto));
  const ganancia = total.minus(params.transferencia);
  const pct = params.transferencia.greaterThan(0) ? ganancia.dividedBy(params.transferencia).times(100) : null;
  const pesados = params.fecha
    ? params.cheques.reduce((acc, c) => {
        const dias = c.fechaCobro ? Math.max(0, Math.round((c.fechaCobro.getTime() - params.fecha!.getTime()) / DIA_MS)) : 0;
        return acc.plus(c.monto.times(dias));
      }, ZERO)
    : ZERO;
  const dias = total.greaterThan(0) ? Math.round(pesados.dividedBy(total).toNumber()) : 0;
  return { total, ganancia, pct, dias };
}
