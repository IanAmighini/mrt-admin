import "server-only";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Un producto es siempre la combinación de una Marca (nombre + tipo de aceite) y un Formato
 * (cajas x botellas por caja x ml). Se reutiliza el Product existente para esa combinación, o se
 * crea uno nuevo — así producción y pedidos nunca quedan bloqueados esperando que alguien "dé de
 * alta" el producto a mano.
 */
export async function resolveOrCreateProduct(tx: Tx, marcaId: string, formatoId: string) {
  const marca = await tx.marca.findUnique({ where: { id: marcaId } });
  if (!marca) throw new Error("Alguna de las marcas seleccionadas ya no existe.");
  const formato = await tx.formato.findUnique({ where: { id: formatoId } });
  if (!formato) throw new Error("Alguno de los formatos seleccionados ya no existe.");

  let product = await tx.product.findFirst({
    where: { name: marca.name, oilType: marca.oilType, presentation: formato.presentation },
    include: { recipe: true },
  });
  if (!product) {
    product = await tx.product.create({
      data: {
        name: marca.name,
        oilType: marca.oilType,
        presentation: formato.presentation,
        boxesPerPallet: formato.boxesPerPallet,
        unitsPerBox: formato.unitsPerBox,
        bottleCapacityMl: formato.bottleCapacityMl,
      },
      include: { recipe: true },
    });
  }
  return product;
}
