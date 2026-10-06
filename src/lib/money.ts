import { Prisma } from "@prisma/client";
import type { Currency } from "@prisma/client";
import { UserError } from "@/lib/user-error";

export const DEFAULT_IVA_RATE = 21;

export const ZERO = new Prisma.Decimal(0);

export function toDecimal(value: string | number | Prisma.Decimal | null | undefined) {
  if (value === null || value === undefined || value === "") return ZERO;
  try {
    return new Prisma.Decimal(value);
  } catch {
    // Decimal tira "[DecimalError] Invalid argument", que no le dice nada a nadie.
    throw new UserError(`"${String(value)}" no es un número válido.`);
  }
}

/** Agrupación de miles con punto: 1.500, 150.000, 12.345.678. Se excluye "0." para que "0.750"
 * no se lea como 750 — nadie escribe un separador de miles después de un cero. */
const MILES = /^(?!0\.)\d{1,3}(\.\d{3})+$/;

/**
 * Convierte un número escrito a mano, en formato argentino: la coma separa los decimales y el punto
 * los miles. "150.000,50" son ciento cincuenta mil con cincuenta centavos.
 *
 * También acepta el punto como decimal ("97.5") cuando no puede ser un separador de miles, para no
 * pelearse con quien lo escriba así. El único caso realmente ambiguo es un punto con exactamente
 * tres dígitos atrás —"1.500"— y ahí gana la lectura argentina: mil quinientos.
 *
 * Tira `UserError` en vez de devolver NaN o cero. Un monto mal escrito que entra como cero es un
 * error silencioso en la cuenta corriente de alguien.
 */
export function parseNumeroEscrito(raw: string, campo: string): Prisma.Decimal {
  const decimal = parseNumeroSuave(raw);
  if (decimal === null) throw new UserError(errorDeFormato(raw, campo));
  return decimal;
}

/**
 * La misma lectura que `parseNumeroEscrito`, pero devuelve `null` en vez de tirar error.
 *
 * Es para los cálculos en vivo del navegador —"12 pallets son 23.328 unidades"— donde el texto está
 * a medio escribir todo el tiempo y romper sería absurdo. Nunca para guardar: ahí se usa la versión
 * que tira error, porque un monto ilegible que entra como cero no se ve hasta que alguien concilia.
 */
export function parseNumeroSuave(raw: string): Prisma.Decimal | null {
  const limpio = raw.trim().replace(/\s/g, "");
  const signo = limpio.startsWith("-") ? -1 : 1;
  const cuerpo = limpio.replace(/^[+-]/, "");

  let normalizado: string;
  if (cuerpo.includes(",")) {
    const i = cuerpo.lastIndexOf(",");
    const entera = cuerpo.slice(0, i);
    const decimales = cuerpo.slice(i + 1);
    // La parte entera se valida ANTES de sacarle los puntos: si no, "1.50,5" pasaría como 150,5
    // en vez de ser el error de tipeo que es.
    const enteraValida = entera === "" || /^\d+$/.test(entera) || MILES.test(entera);
    if (!enteraValida || !/^\d+$/.test(decimales)) return null;
    normalizado = `${entera.replace(/\./g, "") || "0"}.${decimales}`;
  } else if (MILES.test(cuerpo)) {
    normalizado = cuerpo.replace(/\./g, "");
  } else if (/^\d+(\.\d+)?$/.test(cuerpo)) {
    normalizado = cuerpo;
  } else {
    return null;
  }

  const decimal = new Prisma.Decimal(normalizado).times(signo);
  return decimal.isNaN() ? null : decimal;
}

function errorDeFormato(raw: string, campo: string): string {
  return `"${raw}" no es un número válido en ${campo}. Usá coma para los decimales: 150.000,50`;
}

/** Igual que parseNumeroEscrito, pero un campo vacío vale cero en vez de ser un error. */
export function parseNumeroOpcional(raw: string, campo: string): Prisma.Decimal {
  return raw.trim() ? parseNumeroEscrito(raw, campo) : ZERO;
}

/**
 * Un número guardado, escrito como lo escribiría una persona, para prellenar un campo de texto:
 * `-25000.5` sale `-25.000,50`. Vuelve a entrar por `parseNumeroEscrito` sin perder nada.
 *
 * `decimales` sube para los precios chicos: un soplado de U$S 0,0425 con dos decimales sería 0,04 y
 * el remito daría cualquier cosa.
 */
export function formatNumeroEditable(value: Prisma.Decimal | number | string, decimales = 2): string {
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(Number(value.toString()));
}

/**
 * Un número guardado, tal cual, para prellenar un campo de texto que después se vuelve a leer.
 *
 * Lo único que hace es cambiar el punto por la coma, y eso es justamente lo que hay que hacer:
 * `17.952` escrito con punto **se lee como 17.952 unidades**, porque tres dígitos después del
 * punto son un separador de miles en la Argentina. Un pallet y medio se convertía en mil
 * quinientos sin que nadie lo notara.
 *
 * Es distinto de `formatNumeroEditable`, que agrupa los miles y **redondea a dos decimales**: sirve
 * para la plata, pero no para las cantidades, que llevan tres o cuatro.
 */
export function formatNumeroExacto(
  value: Prisma.Decimal | number | string | null | undefined
): string {
  if (value === null || value === undefined) return "";
  // Con todos sus decimales y con el punto de miles, como se escribe acá: "30.543,478". Se vuelve a
  // leer igual —`parseNumeroSuave` entiende los miles cuando hay coma—, y un monto de catorce
  // cifras sin agrupar no se podía leer de un vistazo. `toFixed()` y no `toString()`, que para
  // números muy chicos o muy grandes escribe "1e-7".
  const [entera, decimales] = new Prisma.Decimal(value).toFixed().split(".");
  const signo = entera.startsWith("-") ? "-" : "";
  const agrupada = entera.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimales ? `${signo}${agrupada},${decimales}` : `${signo}${agrupada}`;
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
