import "server-only";
import { Prisma, type Currency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toDecimal } from "@/lib/money";
import { toDateInputValue } from "@/lib/period";

/**
 * La cotización del dólar de cada día, para pasar a pesos lo que está en dólares —el aceite y las
 * preformas de Cristian, las cuentas de Víctor Dilver y Distribuidora Dal— y que el margen y los
 * reportes cuenten lo que de verdad costó y se vendió. Antes esas cuentas quedaban afuera: el aceite
 * no costaba nada y Cristian aparecía con $ 0 en compras.
 *
 * No hay una tabla de cotizaciones: sale de las que se cargaron al usar la app, en comprobantes y en
 * pagos. Para un comprobante, manda la suya; si no la tiene, la de cualquier otro movimiento de ese
 * mismo día (la última que se cargó); y si ese día no se cargó ninguna, la del día anterior más
 * cercano —o, si no hay ninguna antes, la primera que haya después—.
 */
export type Cotizador = {
  /** La cotización con la que se valúa algo del día `fecha`. Null sólo si nunca se cargó ninguna. */
  del: (fecha: Date, propia?: Prisma.Decimal | null) => Prisma.Decimal | null;
  /** El monto en pesos: tal cual si ya está en pesos; si está en dólares, por la cotización del día. */
  aPesos: (
    monto: Prisma.Decimal | number,
    moneda: Currency,
    fecha: Date,
    propia?: Prisma.Decimal | null
  ) => Prisma.Decimal;
};

export async function getCotizador(): Promise<Cotizador> {
  const [pagos, documentos] = await Promise.all([
    prisma.payment.findMany({
      where: { exchangeRate: { not: null } },
      select: { date: true, exchangeRate: true, createdAt: true },
    }),
    prisma.document.findMany({
      where: { exchangeRate: { not: null } },
      select: { date: true, exchangeRate: true, createdAt: true },
    }),
  ]);

  // Por día, la última que se cargó: si ese día hubo dos (1.517 y 1.515,50), vale la más nueva.
  const porDia = new Map<string, { cotizacion: Prisma.Decimal; cargada: Date }>();
  for (const fila of [...pagos, ...documentos]) {
    if (!fila.exchangeRate || fila.exchangeRate.lessThanOrEqualTo(0)) continue;
    const dia = toDateInputValue(fila.date);
    const previa = porDia.get(dia);
    if (!previa || fila.createdAt > previa.cargada) porDia.set(dia, { cotizacion: fila.exchangeRate, cargada: fila.createdAt });
  }
  const dias = Array.from(porDia.keys()).sort();

  const del = (fecha: Date, propia?: Prisma.Decimal | null) => {
    if (propia && propia.greaterThan(0)) return propia;
    if (dias.length === 0) return null;
    const dia = toDateInputValue(fecha);
    const exacta = porDia.get(dia);
    if (exacta) return exacta.cotizacion;
    // El día anterior más cercano: los días son "yyyy-mm-dd", así que se ordenan como texto.
    let anterior: string | null = null;
    for (const d of dias) {
      if (d < dia) anterior = d;
      else break;
    }
    return porDia.get(anterior ?? dias[0])!.cotizacion;
  };

  return {
    del,
    aPesos: (monto, moneda, fecha, propia) => {
      const valor = toDecimal(monto);
      if (moneda !== "USD") return valor;
      const cotizacion = del(fecha, propia);
      return cotizacion ? valor.times(cotizacion) : valor.times(0);
    },
  };
}
