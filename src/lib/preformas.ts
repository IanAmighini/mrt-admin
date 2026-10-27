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
 * Las preformas de la más chica a la más grande —850/900, 1500, 4000/5000—, que es como se piensan.
 * Por nombre quedaban 1500, 4000/5000, 850/900: el orden alfabético compara texto, no números.
 */
export async function getPreformasOrdenadas() {
  const preformas = await prisma.preforma.findMany();
  const tamano = (nombre: string) => Number(nombre.match(/\d+/)?.[0] ?? Infinity);
  return preformas.sort((a, b) => tamano(a.name) - tamano(b.name) || a.name.localeCompare(b.name, "es"));
}

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
    getPreformasOrdenadas(),
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

/**
 * Los que soplan con preformas nuestras: los proveedores que llevan cuenta de preformas. Hoy sólo
 * Teoplast, pero una compra de preformas puede ir a cualquiera de ellos.
 */
export async function getSopladores() {
  return prisma.entity.findMany({
    where: { llevaCuentaPreformas: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * El tipo de preforma de un insumo de la categoría Preformas. Van por nombre —"Preforma 850/900"
 * es del tipo "850/900"— porque `Item.preformaId` es de los envases: ponérselo a la preforma misma
 * haría que la cuenta de preformas la contara como un envase recibido.
 */
export async function tiposDePreforma(itemIds: string[]) {
  const [items, preformas] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds }, category: "PREFORMAS" }, select: { id: true, name: true } }),
    prisma.preforma.findMany({ select: { id: true, name: true } }),
  ]);
  return new Map(
    items.flatMap((i) => {
      const tipo = preformas.find((p) => i.name.trim() === `Preforma ${p.name}`);
      return tipo ? [[i.id, tipo] as const] : [];
    })
  );
}

export type PrecioDeEnvase = {
  /** Todo en dólares, que es en lo que se pactan los dos: el soplado con Teoplast y la preforma con Cristian. */
  soplado: Prisma.Decimal;
  preforma: Prisma.Decimal;
  total: Prisma.Decimal;
  preformaNombre: string;
};

/**
 * El precio al que se sugiere vender un envase: el soplado vigente más lo que costó la preforma la
 * última vez que se compró. Vender sólo al precio del soplado regalaba la preforma, que pusimos
 * nosotros (8.820 envases de 900 a Víctor Dilver a U$S 0,0425, el 26/10). Null si falta alguno de
 * los dos, para no sugerir medio precio.
 */
export async function precioDeReventaDeEnvase(item: {
  precioSopladoUsd: Prisma.Decimal | null;
  preformaId: string | null;
}): Promise<PrecioDeEnvase | null> {
  if (!item.precioSopladoUsd || item.precioSopladoUsd.isZero() || !item.preformaId) return null;
  const tipo = await prisma.preforma.findUnique({ where: { id: item.preformaId }, select: { name: true } });
  if (!tipo) return null;
  const linea = await prisma.purchaseLine.findFirst({
    where: { item: { category: "PREFORMAS", name: `Preforma ${tipo.name}` }, unitPrice: { gt: 0 } },
    orderBy: [{ document: { date: "desc" } }, { document: { createdAt: "desc" } }],
    select: { unitPrice: true, unitPriceUsd: true, document: { select: { currency: true, exchangeRate: true } } },
  });
  if (!linea) return null;
  // En la cuenta de Cristian, que va en dólares, el precio ya es en dólares. Si alguna vez se compra
  // en pesos, vale el pactado en dólares o, si no lo hay, los pesos a la cotización de esa compra.
  const preforma =
    linea.document.currency === "USD"
      ? linea.unitPrice
      : (linea.unitPriceUsd ??
        (linea.document.exchangeRate && !linea.document.exchangeRate.isZero()
          ? linea.unitPrice.dividedBy(linea.document.exchangeRate)
          : null));
  if (!preforma) return null;
  return { soplado: item.precioSopladoUsd, preforma, total: item.precioSopladoUsd.plus(preforma), preformaNombre: tipo.name };
}
