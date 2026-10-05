import "server-only";
import { UserError } from "@/lib/user-error";
import { Prisma, type SupplierCategory } from "@prisma/client";

type Tx = Prisma.TransactionClient;

type MarcaInfo = { name: string; oilType: string; usaEtiqueta: boolean };
type FormatoInfo = {
  presentation: string;
  boxesPerPallet: number;
  unitsPerBox: number;
  bottleCapacityMl: Prisma.Decimal | number;
};

export type RecipeTemplateLine = { itemId: string; quantityPerUnit: Prisma.Decimal };

/**
 * Litros de aceite que entran en un pallet. El rendimiento de llenado descuenta el aire que queda
 * en la botella: una de 900ml al 97% lleva 873ml de aceite.
 */
export function litrosPorPallet(
  unitsPerPallet: number,
  bottleCapacityMl: Prisma.Decimal | number,
  efficiencyPercent: Prisma.Decimal | number
): Prisma.Decimal {
  return new Prisma.Decimal(unitsPerPallet)
    .times(bottleCapacityMl)
    .times(efficiencyPercent)
    .dividedBy(100)
    .dividedBy(1000);
}

/**
 * Tramo de caja al que corresponde un envase. Una misma caja sirve dos tamaños: la de 900 también
 * se usa para los envases de 850, y la de 4000 para los de 3600.
 */
function tramoDeCaja(ml: number): number {
  if (ml <= 900) return 900;
  if (ml <= 1500) return 1500;
  if (ml <= 4000) return 4000;
  return 5000;
}

/**
 * Tapa que corresponde por boca de envase. Las de 29mm (850, 900 y 1500) son tres y se usan
 * indistintamente; se elige una por defecto y al cargar la producción se puede indicar que se usó
 * otra. De 3600 para arriba hay una sola.
 */
function tapaPorBoca(ml: number): string {
  return ml <= 1500 ? "Tapa 29mm Priva Amarilla" : "Tapa 48-41 baja Amarilla";
}

/**
 * Las marcas que etiquetan un envase con la etiqueta de otra medida, por marca + aceite: envase → la
 * medida de la etiqueta que se usa. Va marca por marca y no como regla general a propósito: que
 * una marca no tenga cargada su etiqueta de 850 no quiere decir que use la de 900, y adivinarlo
 * descontaría etiquetas que no se usaron. Se agrega acá cuando producción lo confirma.
 */
const ETIQUETA_DE_OTRA_MEDIDA: Record<string, Record<number, number>> = {
  "Goye Girasol": { 850: 900 },
};

/** Un ml entero para armar nombres: `Decimal(900.00)` tiene que dar "900", no "900.00". */
function ml(value: Prisma.Decimal | number): number {
  return Math.round(Number(value));
}

/**
 * Arma la receta de un producto a partir de su marca y su formato, sin que nadie la cargue a mano.
 *
 * Se puede porque el consumo de un pallet está completamente determinado: el envase y la etiqueta
 * salen de los mililitros, la tapa de la boca, la caja de la marca (o lisa si esa marca no tiene
 * caja propia), y el aceite del tipo de la marca. Lo único que no es mecánico es cuál de las tres
 * tapas de 29mm se usó, y eso se elige al cargar la producción.
 *
 * Si falta un insumo obligatorio **tira error en vez de saltearlo**: una receta incompleta no da
 * ningún aviso al envasar, simplemente no descuenta ese insumo, y el faltante recién aparece
 * cuando alguien cuenta el stock físico.
 */
export async function buildRecipeTemplate(
  tx: Tx,
  marca: MarcaInfo,
  formato: FormatoInfo,
  oilFillEfficiencyPercent: Prisma.Decimal | number
): Promise<RecipeTemplateLine[]> {
  const capacidad = ml(formato.bottleCapacityMl);
  const unitsPerPallet = formato.boxesPerPallet * formato.unitsPerBox;
  const tramo = tramoDeCaja(capacidad);

  const cajaDeMarca = `Caja ${marca.name} ${formato.unitsPerBox}x${tramo}`;
  const cajaLisa = `Caja Lisa ${formato.unitsPerBox}x${tramo}`;
  const etiquetaPropia = `Etiqueta ${marca.name} ${marca.oilType} ${capacidad}ml`;
  const otraMedida = ETIQUETA_DE_OTRA_MEDIDA[`${marca.name} ${marca.oilType}`]?.[capacidad];
  const etiquetaPrestada = otraMedida ? `Etiqueta ${marca.name} ${marca.oilType} ${otraMedida}ml` : null;

  const nombres = [
    "Pallet de madera",
    `Envase ${capacidad}ml`,
    tapaPorBoca(capacidad),
    cajaDeMarca,
    cajaLisa,
    `Aceite ${marca.oilType}`,
    ...(marca.usaEtiqueta ? [etiquetaPropia, ...(etiquetaPrestada ? [etiquetaPrestada] : [])] : []),
  ];

  const items = await tx.item.findMany({
    // `llevaStock` acota a los que se pueden consumir: si alguien nombrara igual a un consumible
    // que no lleva stock, la receta anotaría un consumo que no descuenta de ningún lado. Al no
    // encontrarlo, `exigir()` avisa con nombre en vez de dejarlo pasar.
    where: { name: { in: nombres }, llevaStock: true },
    select: { id: true, name: true, category: true },
  });
  const porNombre = new Map(items.map((i) => [i.name, i]));

  const producto = `${marca.name} ${marca.oilType} ${formato.presentation}`;
  function exigir(nombre: string, categoria: SupplierCategory) {
    const item = porNombre.get(nombre);
    if (!item) {
      throw new UserError(
        `No se puede armar la receta de ${producto}: falta el insumo "${nombre}". Cargalo en Stock y volvé a intentar.`
      );
    }
    if (item.category !== categoria) {
      throw new UserError(
        `No se puede armar la receta de ${producto}: "${nombre}" está cargado como ${item.category} y tendría que ser ${categoria}.`
      );
    }
    return item.id;
  }

  const porBotella = new Prisma.Decimal(unitsPerPallet);
  const lines: RecipeTemplateLine[] = [
    { itemId: exigir("Pallet de madera", "PALLET_NORMALIZADO"), quantityPerUnit: new Prisma.Decimal(1) },
    { itemId: exigir(`Envase ${capacidad}ml`, "ENVASES"), quantityPerUnit: porBotella },
    { itemId: exigir(tapaPorBoca(capacidad), "TAPAS"), quantityPerUnit: porBotella },
    {
      // Si la marca no tiene caja propia va la lisa — la misma regla que se aplica cuando se
      // quedan sin cajas de la marca y se elige otra al cargar la producción.
      itemId: porNombre.has(cajaDeMarca) ? exigir(cajaDeMarca, "CAJAS") : exigir(cajaLisa, "CAJAS"),
      quantityPerUnit: new Prisma.Decimal(formato.boxesPerPallet),
    },
    {
      itemId: exigir(`Aceite ${marca.oilType}`, "ACEITE"),
      quantityPerUnit: litrosPorPallet(unitsPerPallet, formato.bottleCapacityMl, oilFillEfficiencyPercent),
    },
  ];

  // Sin etiqueta es producto terminado sin etiquetar, así que ahí la ausencia es correcta. Para el
  // resto, que falte es un error: exigir() lo dice con nombre y apellido.
  if (marca.usaEtiqueta) {
    // La propia, si existe, gana siempre: la prestada es sólo para cuando la marca no la tiene.
    const etiqueta =
      etiquetaPrestada && !porNombre.has(etiquetaPropia) && porNombre.has(etiquetaPrestada) ? etiquetaPrestada : etiquetaPropia;
    lines.push({ itemId: exigir(etiqueta, "ETIQUETAS"), quantityPerUnit: porBotella });
  }

  return lines;
}
