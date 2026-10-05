import "server-only";
import { UserError } from "@/lib/user-error";
import type { Prisma } from "@prisma/client";
import { generateUniqueSlug } from "./slug";
import { buildRecipeTemplate, type RecipeTemplateLine } from "./recipe-template";

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
  oilFillEfficiencyPercent: Prisma.Decimal | number,
  opciones: {
    /**
     * Un pedido es a futuro: se toma aunque todavía falte cargar algún insumo —la etiqueta de una
     * marca nueva—, y el producto queda sin receta hasta que se produzca. Producción sí la exige, y
     * la arma en ese momento.
     */
    recetaOpcional?: boolean;
  } = {}
) {
  const marca = await tx.marca.findUnique({ where: { id: marcaId } });
  if (!marca) throw new UserError("Alguna de las marcas seleccionadas ya no existe.");
  const formato = await tx.formato.findUnique({ where: { id: formatoId } });
  if (!formato) throw new UserError("Alguno de los formatos seleccionados ya no existe.");

  const existente = await tx.product.findFirst({
    where: { name: marca.name, oilType: marca.oilType, presentation: formato.presentation },
    include: { recipe: { include: { item: true } } },
  });
  if (existente) {
    if (existente.recipe.length > 0 || opciones.recetaOpcional) return existente;
    // Nació de un pedido, sin receta: se arma ahora, que es cuando se va a envasar. Si sigue faltando
    // el insumo, el error lo dice con nombre.
    const receta = await buildRecipeTemplate(tx, marca, formato, oilFillEfficiencyPercent);
    await tx.recipeItem.createMany({ data: receta.map((r) => ({ ...r, productId: existente.id })) });
    return tx.product.findUniqueOrThrow({
      where: { id: existente.id },
      include: { recipe: { include: { item: true } } },
    });
  }

  // El nombre solo (la "marca") se repite entre presentaciones distintas del mismo producto —
  // se suma oilType + presentation para que el slug identifique la presentación puntual.
  const slug = await generateUniqueSlug(
    `${marca.name} ${marca.oilType} ${formato.presentation}`,
    (candidate) => tx.product.findUnique({ where: { slug: candidate } }).then(Boolean),
    "producto"
  );

  // Se arma antes de crear el producto: si falta un insumo, mejor que no quede un producto huérfano
  // sin receta, que es justamente lo que se está tratando de evitar. Salvo para un pedido, que no
  // envasa nada: ahí queda sin receta y se arma al producirlo.
  let recipe: RecipeTemplateLine[] = [];
  try {
    recipe = await buildRecipeTemplate(tx, marca, formato, oilFillEfficiencyPercent);
  } catch (e) {
    if (!(opciones.recetaOpcional && e instanceof UserError)) throw e;
  }

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
