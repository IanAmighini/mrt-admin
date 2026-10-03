import "server-only";
import { Prisma, type SupplierCategory } from "@prisma/client";
import { prisma } from "./prisma";
import { UserError } from "./user-error";

type Cliente = Prisma.TransactionClient | typeof prisma;

/**
 * La caja de un producto: marca + aceite + ml + botellas por caja.
 *
 * Los productos que ya existían la tienen desde la migración. Los que se crean después —se arman
 * solos al cargar la primera producción de una marca y formato nuevos— la consiguen acá la primera
 * vez que hace falta, así nadie tiene que acordarse de crearla.
 */
export async function cajaDelProducto(
  db: Cliente,
  product: {
    id: string;
    name: string;
    oilType: string;
    presentation: string;
    bottleCapacityMl: Prisma.Decimal | null;
    unitsPerBox: number | null;
    cajaId: string | null;
  }
): Promise<string> {
  if (product.cajaId) return product.cajaId;
  if (!product.bottleCapacityMl || !product.unitsPerBox) {
    throw new UserError(
      `${product.name} ${product.oilType} ${product.presentation} no tiene cargados los ml de la botella o las botellas por caja, así que no se puede saber cuál es su caja. Completalo en la ficha del producto.`
    );
  }
  const caja = await db.caja.upsert({
    where: {
      name_oilType_bottleCapacityMl_unitsPerBox: {
        name: product.name,
        oilType: product.oilType,
        bottleCapacityMl: product.bottleCapacityMl,
        unitsPerBox: product.unitsPerBox,
      },
    },
    update: {},
    create: {
      name: product.name,
      oilType: product.oilType,
      bottleCapacityMl: product.bottleCapacityMl,
      unitsPerBox: product.unitsPerBox,
    },
  });
  await db.product.update({ where: { id: product.id }, data: { cajaId: caja.id } });
  return caja.id;
}

/** Las cajas sueltas que hay de cada caja, sumando todos sus movimientos. */
export async function getStockDeCajas(db: Cliente = prisma): Promise<Map<string, number>> {
  const filas = await db.cajaMovement.groupBy({ by: ["cajaId"], _sum: { quantity: true } });
  return new Map(filas.map((f) => [f.cajaId, f._sum.quantity ?? 0]));
}

/**
 * Lo que va en una caja suelta y no en un pallet: todo lo de la receta menos el pallet de madera y
 * el stretch, que son del pallet. La receta está escrita por pallet, así que cada renglón se divide
 * por las cajas que lleva.
 */
const SOLO_DEL_PALLET: SupplierCategory[] = ["PALLET_NORMALIZADO", "STRETCH"];

export function recetaPorCaja<T extends { quantityPerUnit: Prisma.Decimal; item: { category: SupplierCategory } }>(
  receta: T[],
  boxesPerPallet: number
): (T & { porCaja: Prisma.Decimal })[] {
  return receta
    .filter((r) => !SOLO_DEL_PALLET.includes(r.item.category))
    .map((r) => ({ ...r, porCaja: new Prisma.Decimal(r.quantityPerUnit).dividedBy(boxesPerPallet) }));
}

/** Que un número de pallets o de cajas sea entero: no existe medio pallet ni media caja. */
export function enteroNoNegativo(valor: Prisma.Decimal, que: string): number {
  if (valor.isNegative()) throw new UserError(`${que}: no puede ser un número negativo.`);
  if (!valor.isInteger()) throw new UserError(`${que}: tiene que ser un número entero.`);
  return valor.toNumber();
}

/** Lo que hay de cada producto, para mostrarlo en el formulario de entrega mientras se carga. */
export type StockDeProducto = { pallets: number; sueltas: number; cajaId: string | null };

export async function getStockParaFormulario(): Promise<Record<string, StockDeProducto>> {
  const [productos, movimientos, sueltas] = await Promise.all([
    prisma.product.findMany({ select: { id: true, cajaId: true } }),
    prisma.productMovement.groupBy({ by: ["productId"], _sum: { quantity: true } }),
    getStockDeCajas(),
  ]);
  const pallets = new Map(movimientos.map((m) => [m.productId, Number(m._sum.quantity ?? 0)]));
  return Object.fromEntries(
    productos.map((p) => [
      p.id,
      { pallets: pallets.get(p.id) ?? 0, sueltas: p.cajaId ? (sueltas.get(p.cajaId) ?? 0) : 0, cajaId: p.cajaId },
    ])
  );
}
