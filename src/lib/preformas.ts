import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, ZERO } from "@/lib/money";

/**
 * Lo que se pierde al soplar: de cada 100 preformas que pone el proveedor, una se rompe y también
 * se la debemos. Va sobre los envases que él entrega, que es donde se produce la rotura.
 */
export const MERMA_PREFORMA = new Prisma.Decimal("0.01");

export type DeudaPreforma = {
  preformaId: string;
  nombre: string;
  /** Lo que ya se le debía antes de empezar a usar la app. */
  saldoInicial: Prisma.Decimal;
  /** Unidades de envase que entregó el proveedor: cada una consumió una preforma suya. */
  recibidas: Prisma.Decimal;
  /** El 1% de lo recibido: las que se rompieron al soplar. */
  merma: Prisma.Decimal;
  /** Preformas que se le entregaron para cancelar. */
  entregadas: Prisma.Decimal;
  /** Lo que todavía se le debe, en unidades. */
  saldo: Prisma.Decimal;
};

/**
 * Cuántas preformas se le deben a un proveedor que las fía, por tipo.
 *
 * No hay una cuenta cargada a mano: cada envase soplado consumió una preforma que puso él, así que
 * la deuda sale de las unidades que ya quedaron registradas al cargar los remitos —más la merma del
 * soplado— menos lo que se le entregó, sobre el saldo con el que arrancó la cuenta. Llevar el
 * número aparte se desincronizaría el primer día que alguien cargue un remito y se olvide de la
 * otra pantalla.
 */
export async function getDeudaPreformas(entityId: string): Promise<DeudaPreforma[]> {
  const [preformas, lineas, entregas, iniciales] = await Promise.all([
    prisma.preforma.findMany({ orderBy: { name: "asc" } }),
    prisma.purchaseLine.findMany({
      where: { document: { account: { entityId } }, item: { preformaId: { not: null } } },
      select: { quantity: true, item: { select: { preformaId: true } } },
    }),
    prisma.entregaPreforma.groupBy({
      by: ["preformaId"],
      where: { entityId },
      _sum: { quantity: true },
    }),
    prisma.preformaSaldoInicial.findMany({ where: { entityId } }),
  ]);

  const entregadoPor = new Map(entregas.map((e) => [e.preformaId, e._sum.quantity ?? ZERO]));
  const inicialPor = new Map(iniciales.map((s) => [s.preformaId, s.quantity]));

  return preformas
    .map((preforma) => {
      const recibidas = sumDecimals(
        lineas.filter((l) => l.item.preformaId === preforma.id).map((l) => l.quantity)
      );
      // A dos decimales, sin redondear las unidades: media preforma de merma es media preforma.
      const merma = recibidas.times(MERMA_PREFORMA).toDecimalPlaces(2);
      const entregadas = entregadoPor.get(preforma.id) ?? ZERO;
      const saldoInicial = inicialPor.get(preforma.id) ?? ZERO;
      return {
        preformaId: preforma.id,
        nombre: preforma.name,
        saldoInicial,
        recibidas,
        merma,
        entregadas,
        saldo: saldoInicial.plus(recibidas).plus(merma).minus(entregadas),
      };
    })
    // Un tipo sin nada de ningún lado no aporta nada a la pantalla.
    .filter((d) => !d.recibidas.isZero() || !d.entregadas.isZero() || !d.saldoInicial.isZero());
}

/** Unidades que trae una cantidad de pallets del proveedor. Pallets puede tener decimales. */
export function unidadesDesdePallets(
  pallets: Prisma.Decimal | number | string,
  unitsPerPallet: number
): Prisma.Decimal {
  return new Prisma.Decimal(pallets).times(unitsPerPallet);
}
