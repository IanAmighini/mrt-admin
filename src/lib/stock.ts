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
