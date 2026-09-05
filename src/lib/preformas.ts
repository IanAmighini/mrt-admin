import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, ZERO } from "@/lib/money";

export type DeudaPreforma = {
  preformaId: string;
  nombre: string;
  /** Unidades de envase que entregó el proveedor: cada una consumió una preforma suya. */
  recibidas: Prisma.Decimal;
  /** Preformas que se le entregaron para cancelar. */
  entregadas: Prisma.Decimal;
  /** Lo que todavía se le debe, en unidades. */
  saldo: Prisma.Decimal;
};

/**
 * Cuántas preformas se le deben a un proveedor que las fía, por tipo.
 *
 * No hay una cuenta cargada a mano: cada envase soplado consumió una preforma que puso él, así que
 * la deuda sale de las unidades que ya quedaron registradas al cargar los remitos, menos lo que se
 * le entregó. Llevar el número aparte se desincronizaría el primer día que alguien cargue un remito
 * y se olvide de la otra pantalla.
 */
export async function getDeudaPreformas(entityId: string): Promise<DeudaPreforma[]> {
  const [preformas, lineas, entregas] = await Promise.all([
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
  ]);

  const entregadoPor = new Map(entregas.map((e) => [e.preformaId, e._sum.quantity ?? ZERO]));

  return preformas
    .map((preforma) => {
      const recibidas = sumDecimals(
        lineas.filter((l) => l.item.preformaId === preforma.id).map((l) => l.quantity)
      );
      const entregadas = entregadoPor.get(preforma.id) ?? ZERO;
      return {
        preformaId: preforma.id,
        nombre: preforma.name,
        recibidas,
        entregadas,
        saldo: recibidas.minus(entregadas),
      };
    })
    // Un tipo sin nada de un lado ni del otro no aporta nada a la pantalla.
    .filter((d) => !d.recibidas.isZero() || !d.entregadas.isZero());
}

/** Unidades que trae una cantidad de pallets del proveedor. Pallets puede tener decimales. */
export function unidadesDesdePallets(
  pallets: Prisma.Decimal | number | string,
  unitsPerPallet: number
): Prisma.Decimal {
  return new Prisma.Decimal(pallets).times(unitsPerPallet);
}
