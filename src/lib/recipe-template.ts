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
 * Centímetros de cinta que lleva una caja al cerrarla, por tramo de caja (Ian, 6/11/2026). La de 900
 * es la misma para 850 y 800, así que lleva lo mismo.
 */
const CINTA_CM_POR_CAJA: Record<number, number> = { 900: 92, 1500: 103, 4000: 94, 5000: 92 };
/** Lo que trae un rollo de cinta: la cinta se compra y se cuenta por rollo. */
const METROS_POR_ROLLO = 1000;

/** Rollos de cinta que se gastan en un pallet: los centímetros de cada caja por las cajas del pallet. */
export function rollosDeCintaPorPallet(boxesPerPallet: number, bottleCapacityMl: Prisma.Decimal | number): Prisma.Decimal {
  const cm = CINTA_CM_POR_CAJA[tramoDeCaja(ml(bottleCapacityMl))];
  return new Prisma.Decimal(boxesPerPallet).times(cm).dividedBy(100).dividedBy(METROS_POR_ROLLO);
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
 * Los envases que se etiquetan con la etiqueta de otra medida: envase → la medida de la etiqueta.
 * **Las etiquetas de 850 no existen: toda botella de 850 lleva la de 900 de su marca** (confirmado
 * el 19/10/2026), y la de 750 lleva la de 800. Antes iba marca por marca —sólo Goye— y la receta de Don José 850 apuntaba a una
 * "Etiqueta 850ml" cargada en el catálogo que nunca se compra ni se usa.
 */
const ETIQUETA_DE_OTRA_MEDIDA: Record<number, number> = {
  850: 900,
  // La presentación "x800" se llena en el envase de 750 y lleva la etiqueta de 800 (23/10/2026).
  750: 800,
};

/**
 * El aceite que trae un cliente al que le hacemos fasón: se llama «Aceite Girasol de Solterra».
 * Si existe ese insumo, la receta de la marca lo usa en vez del nuestro (Ian, 11/11/2026).
 */
export function nombreDelAceiteDelCliente(marca: { name: string; oilType: string }): string {
  return `Aceite ${marca.oilType} de ${marca.name}`;
}

/** Un ml entero para armar nombres: `Decimal(900.00)` tiene que dar "900", no "900.00". */
function ml(value: Prisma.Decimal | number): number {
  return Math.round(Number(value));
}

type ItemDeReceta = { id: string; name: string; category: SupplierCategory; unit: string };

/** Los nombres de insumo que puede llegar a usar la receta automática de una marca y un formato. */
export function nombresDeLaPlantilla(marca: MarcaInfo, formato: FormatoInfo): string[] {
  const capacidad = ml(formato.bottleCapacityMl);
  const tramo = tramoDeCaja(capacidad);
  const otraMedida = ETIQUETA_DE_OTRA_MEDIDA[capacidad];
  return [
    "Pallet de madera",
    `Envase ${capacidad}ml`,
    tapaPorBoca(capacidad),
    `Caja ${marca.name} ${formato.unitsPerBox}x${tramo}`,
    `Caja Lisa ${formato.unitsPerBox}x${tramo}`,
    `Aceite ${marca.oilType}`,
    nombreDelAceiteDelCliente(marca),
    "Cinta",
    ...(marca.usaEtiqueta
      ? [
          `Etiqueta ${marca.name} ${marca.oilType} ${capacidad}ml`,
          ...(otraMedida ? [`Etiqueta ${marca.name} ${marca.oilType} ${otraMedida}ml`] : []),
        ]
      : []),
  ];
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
 *
 * No toca la base: recibe los insumos ya leídos, así se puede calcular la de todas las
 * combinaciones de una vez para mostrarla antes de producir. `buildRecipeTemplate` es la que los lee.
 */
export function plantillaDeReceta(
  marca: MarcaInfo,
  formato: FormatoInfo,
  oilFillEfficiencyPercent: Prisma.Decimal | number,
  porNombre: Map<string, ItemDeReceta>
): RecipeTemplateLine[] {
  const capacidad = ml(formato.bottleCapacityMl);
  const unitsPerPallet = formato.boxesPerPallet * formato.unitsPerBox;
  const tramo = tramoDeCaja(capacidad);

  const cajaDeMarca = `Caja ${marca.name} ${formato.unitsPerBox}x${tramo}`;
  const cajaLisa = `Caja Lisa ${formato.unitsPerBox}x${tramo}`;
  const etiquetaPropia = `Etiqueta ${marca.name} ${marca.oilType} ${capacidad}ml`;
  const otraMedida = ETIQUETA_DE_OTRA_MEDIDA[capacidad];
  const etiquetaPrestada = otraMedida ? `Etiqueta ${marca.name} ${marca.oilType} ${otraMedida}ml` : null;

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

  /**
   * **Fasón:** si la marca trae su aceite, se le descuenta al 100% —cada botella de 5 L, 5 L— y lo
   * que no se usa por el rendimiento de llenado es nuestro: entra a nuestro aceite en la misma
   * línea, en negativo. Así su saldo es lo que le debemos envasar, y la ganancia baja el costo del
   * pallet y sube la Valorización sin cargar nada a mano. El sobrante queda en su tanque hasta que
   * se pasa al nuestro.
   */
  function lineasDeAceite(): RecipeTemplateLine[] {
    const nuestro = exigir(`Aceite ${marca.oilType}`, "ACEITE");
    const delCliente = nombreDelAceiteDelCliente(marca);
    if (!porNombre.has(delCliente)) {
      return [{ itemId: nuestro, quantityPerUnit: litrosPorPallet(unitsPerPallet, formato.bottleCapacityMl, oilFillEfficiencyPercent) }];
    }
    const sobra = new Prisma.Decimal(100).minus(oilFillEfficiencyPercent);
    return [
      { itemId: exigir(delCliente, "ACEITE"), quantityPerUnit: litrosPorPallet(unitsPerPallet, formato.bottleCapacityMl, 100) },
      ...(sobra.greaterThan(0)
        ? [{ itemId: nuestro, quantityPerUnit: litrosPorPallet(unitsPerPallet, formato.bottleCapacityMl, sobra).negated() }]
        : []),
    ];
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
    ...lineasDeAceite(),
    // La que cierra cada caja. Va por pallet como el resto; una caja suelta se lleva su parte.
    {
      itemId: exigir("Cinta", "CINTA"),
      quantityPerUnit: rollosDeCintaPorPallet(formato.boxesPerPallet, formato.bottleCapacityMl),
    },
  ];

  // Sin etiqueta es producto terminado sin etiquetar, así que ahí la ausencia es correcta. Para el
  // resto, que falte es un error: exigir() lo dice con nombre y apellido.
  if (marca.usaEtiqueta) {
    // La de la otra medida gana cuando existe: la de 850 que figure en el catálogo no se usa. Si la
    // marca no tiene la de 900 cargada, queda la propia y exigir() la pide por su nombre.
    // Y si no hay ninguna de las dos, se pide la prestada: la de la medida del envase no existe (no
    // hay etiquetas de 850 ni de 750), así que pedirla mandaba a cargar un insumo que no se usa.
    const etiqueta =
      etiquetaPrestada && (porNombre.has(etiquetaPrestada) || !porNombre.has(etiquetaPropia))
        ? etiquetaPrestada
        : etiquetaPropia;
    lines.push({ itemId: exigir(etiqueta, "ETIQUETAS"), quantityPerUnit: porBotella });
  }

  return lines;
}

/** Los insumos que se pueden poner en una receta, por nombre. */
export async function insumosDeRecetaPorNombre(tx: Tx, nombres?: string[]): Promise<Map<string, ItemDeReceta>> {
  const items = await tx.item.findMany({
    // `llevaStock` acota a los que se pueden consumir: si alguien nombrara igual a un consumible
    // que no lleva stock, la receta anotaría un consumo que no descuenta de ningún lado. Al no
    // encontrarlo, `exigir()` avisa con nombre en vez de dejarlo pasar.
    where: { ...(nombres ? { name: { in: nombres } } : {}), llevaStock: true },
    select: { id: true, name: true, category: true, unit: true },
  });
  return new Map(items.map((i) => [i.name, i]));
}

export async function buildRecipeTemplate(
  tx: Tx,
  marca: MarcaInfo,
  formato: FormatoInfo,
  oilFillEfficiencyPercent: Prisma.Decimal | number
): Promise<RecipeTemplateLine[]> {
  const porNombre = await insumosDeRecetaPorNombre(tx, nombresDeLaPlantilla(marca, formato));
  return plantillaDeReceta(marca, formato, oilFillEfficiencyPercent, porNombre);
}
