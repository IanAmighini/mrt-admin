import { Prisma } from "@prisma/client";
import type { Currency } from "@prisma/client";

export const DEFAULT_IVA_RATE = 21;

export const ZERO = new Prisma.Decimal(0);

export function toDecimal(value: string | number | Prisma.Decimal | null | undefined) {
  if (value === null || value === undefined || value === "") return ZERO;
  return new Prisma.Decimal(value);
}

export function sumDecimals(values: (Prisma.Decimal | number | string | null | undefined)[]) {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(toDecimal(v)), ZERO);
}

const CURRENCY_FORMATTERS: Record<Currency, Intl.NumberFormat> = {
  ARS: new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }),
  USD: new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD" }),
};

export function formatMoney(value: Prisma.Decimal | number | string, currency: Currency = "ARS") {
  const num = value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
  return CURRENCY_FORMATTERS[currency].format(num);
}

const QUANTITY_FORMATTER = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

export function formatQuantity(value: Prisma.Decimal | number | string, unit?: string) {
  const num = value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
  const formatted = QUANTITY_FORMATTER.format(num);
  return unit ? `${formatted} ${unit}` : formatted;
}
