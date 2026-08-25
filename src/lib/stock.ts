import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals } from "@/lib/money";

export async function getItemMovements(itemId: string) {
  return prisma.itemMovement.findMany({
    where: { itemId },
    include: { createdBy: true },
    orderBy: { date: "asc" },
  });
}

export async function getItemStock(itemId: string): Promise<Prisma.Decimal> {
  const movements = await prisma.itemMovement.findMany({ where: { itemId } });
  return sumDecimals(movements.map((m) => m.quantity));
}

export async function getAllItemStocks(): Promise<Map<string, Prisma.Decimal>> {
  const movements = await prisma.itemMovement.findMany();
  const stocks = new Map<string, Prisma.Decimal>();
  for (const movement of movements) {
    const current = stocks.get(movement.itemId) ?? sumDecimals([]);
    stocks.set(movement.itemId, current.plus(movement.quantity));
  }
  return stocks;
}

export async function getProductMovements(productId: string) {
  return prisma.productMovement.findMany({
    where: { productId },
    include: { createdBy: true },
    orderBy: { date: "asc" },
  });
}

export async function getProductStock(productId: string): Promise<Prisma.Decimal> {
  const movements = await prisma.productMovement.findMany({ where: { productId } });
  return sumDecimals(movements.map((m) => m.quantity));
}

export async function getAllProductStocks(): Promise<Map<string, Prisma.Decimal>> {
  const movements = await prisma.productMovement.findMany();
  const stocks = new Map<string, Prisma.Decimal>();
  for (const movement of movements) {
    const current = stocks.get(movement.productId) ?? sumDecimals([]);
    stocks.set(movement.productId, current.plus(movement.quantity));
  }
  return stocks;
}

export async function getBoxMovements(boxTypeId: string) {
  return prisma.boxMovement.findMany({
    where: { boxTypeId },
    include: { createdBy: true },
    orderBy: { date: "asc" },
  });
}

export async function getBoxStock(boxTypeId: string): Promise<Prisma.Decimal> {
  const movements = await prisma.boxMovement.findMany({ where: { boxTypeId } });
  return sumDecimals(movements.map((m) => m.quantity));
}

export async function getAllBoxStocks(): Promise<Map<string, Prisma.Decimal>> {
  const movements = await prisma.boxMovement.findMany();
  const stocks = new Map<string, Prisma.Decimal>();
  for (const movement of movements) {
    const current = stocks.get(movement.boxTypeId) ?? sumDecimals([]);
    stocks.set(movement.boxTypeId, current.plus(movement.quantity));
  }
  return stocks;
}

export type ProductStockLevels = {
  suelto: Prisma.Decimal;
  enCajas: Prisma.Decimal;
  enPallets: Prisma.Decimal;
};

/**
 * Stock de cada producto en sus tres niveles (todo expresado en unidades sueltas
 * equivalentes, multiplicando por `unitsPerBox` para poder sumar cajas de distinto tamaño):
 * suelto (sin envasar en caja), en cajas armadas sueltas, y en pallets armados.
 */
export async function getAllProductStockLevels(): Promise<Map<string, ProductStockLevels>> {
  const [sueltoStocks, boxTypes, boxMovements, palletBoxes] = await Promise.all([
    getAllProductStocks(),
    prisma.boxType.findMany(),
    prisma.boxMovement.findMany(),
    prisma.palletBox.findMany({ include: { pallet: true } }),
  ]);

  const boxStockByType = new Map<string, Prisma.Decimal>();
  for (const movement of boxMovements) {
    const current = boxStockByType.get(movement.boxTypeId) ?? sumDecimals([]);
    boxStockByType.set(movement.boxTypeId, current.plus(movement.quantity));
  }

  const palletBoxByType = new Map<string, Prisma.Decimal>();
  for (const pb of palletBoxes) {
    if (pb.pallet.status !== "ARMADO") continue;
    const current = palletBoxByType.get(pb.boxTypeId) ?? sumDecimals([]);
    palletBoxByType.set(pb.boxTypeId, current.plus(pb.quantity));
  }

  const levels = new Map<string, ProductStockLevels>();
  for (const [productId, suelto] of sueltoStocks) {
    levels.set(productId, { suelto, enCajas: sumDecimals([]), enPallets: sumDecimals([]) });
  }

  for (const boxType of boxTypes) {
    const current = levels.get(boxType.productId) ?? {
      suelto: sumDecimals([]),
      enCajas: sumDecimals([]),
      enPallets: sumDecimals([]),
    };
    const cajaStock = boxStockByType.get(boxType.id) ?? sumDecimals([]);
    const palletStock = palletBoxByType.get(boxType.id) ?? sumDecimals([]);
    current.enCajas = current.enCajas.plus(cajaStock.times(boxType.unitsPerBox));
    current.enPallets = current.enPallets.plus(palletStock.times(boxType.unitsPerBox));
    levels.set(boxType.productId, current);
  }

  return levels;
}
