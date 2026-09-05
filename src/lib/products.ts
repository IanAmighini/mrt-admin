import "server-only";
import type { Prisma } from "@prisma/client";
import { generateUniqueSlug } from "./slug";
import { buildRecipeTemplate } from "./recipe-template";

type Tx = Prisma.TransactionClient;

/**
 * Un producto es siempre la combinación de una Marca (nombre + tipo de aceite) y un Formato
 * (cajas x botellas por caja x ml). Se reutiliza el Product existente para esa combinación, o se
 * crea uno nuevo — así producción y pedidos nunca quedan bloqueados esperando que alguien "dé de
 * alta" el producto a mano.
 *
 * Al crearlo se le arma la receta sola. Antes nacía sin receta, y un producto sin receta se envasa
 * sin descontar un solo insumo: no falla, no avisa, y el faltante recién aparece contando el stock
 * físico. Con marcas como "Sin etiqueta", que sale en cualquiera de los 12 formatos y con
 * cualquiera de los 3 aceites, cargar 36 recetas a mano por las dudas no era una opción.
 */
export async function resolveOrCreateProduct(
  tx: Tx,
  marcaId: string,
  formatoId: string,
  /** Rendimiento de llenado, para los litros de aceite. Se lee una vez antes de la transacción. */
  oilFillEfficiencyPercent: Prisma.Decimal | number
) {
  const marca = await tx.marca.findUnique({ where: { id: marcaId } });
  if (!marca) throw new Error("Alguna de las marcas seleccionadas ya no existe.");
  const formato = await tx.formato.findUnique({ where: { id: formatoId } });
  if (!formato) throw new Error("Alguno de los formatos seleccionados ya no existe.");

  const existente = await tx.product.findFirst({
    where: { name: marca.name, oilType: marca.oilType, presentation: formato.presentation },
    include: { recipe: { include: { item: true } } },
  });
  if (existente) return existente;

  // El nombre solo (la "marca") se repite entre presentaciones distintas del mismo producto —
  // se suma oilType + presentation para que el slug identifique la presentación puntual.
  const slug = await generateUniqueSlug(
    `${marca.name} ${marca.oilType} ${formato.presentation}`,
    (candidate) => tx.product.findUnique({ where: { slug: candidate } }).then(Boolean),
    "producto"
  );

  // Se arma antes de crear el producto: si falta un insumo, mejor que no quede un producto huérfano
  // sin receta, que es justamente lo que se está tratando de evitar.
  const recipe = await buildRecipeTemplate(tx, marca, formato, oilFillEfficiencyPercent);

  return tx.product.create({
    data: {
      name: marca.name,
      slug,
      oilType: marca.oilType,
      presentation: formato.presentation,
      boxesPerPallet: formato.boxesPerPallet,
      unitsPerBox: formato.unitsPerBox,
      bottleCapacityMl: formato.bottleCapacityMl,
      recipe: { create: recipe },
    },
    include: { recipe: { include: { item: true } } },
  });
}
