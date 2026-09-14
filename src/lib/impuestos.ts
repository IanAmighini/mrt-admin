import { Prisma, type Circuit, type Currency, type ExpenseCategory, type TaxKind } from "@prisma/client";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import {
  DEFAULT_IVA_RATE,
  formatMoney,
  parseNumeroEscrito,
  parseNumeroOpcional,
  parseNumeroSuave,
  sumDecimals,
  ZERO,
} from "@/lib/money";
import { UserError } from "@/lib/user-error";

/**
 * Alícuotas de IVA que ofrece el formulario de gasto, en filas fijas. Son las tres que existen en
 * la práctica; una factura puede traer más de una y por eso el desglose va en filas y no en una
 * columna por alícuota.
 */
export const ALICUOTAS_IVA = ["21", "10,5", "27"] as const;

/**
 * Los renglones que no son IVA, en el orden y con los nombres de la planilla que se llevaba a mano:
 * cada uno es un campo del formulario y una columna del libro.
 *
 * `OTRO_TRIBUTO` es el comodín para el régimen que aparece de vez en cuando y no tiene columna
 * propia; lleva su nombre escrito al lado.
 */
export const OTROS_TRIBUTOS: { name: string; kind: TaxKind; label: string }[] = [
  { name: "noGravado", kind: "NO_GRAVADO", label: "No gravado" },
  { name: "iibbBsAs", kind: "PERCEPCION_IIBB_BSAS", label: "Ing. Brutos BsAs" },
  { name: "iibbCaba", kind: "PERCEPCION_IIBB_CABA", label: "Ing. Brutos CABA" },
  { name: "iibbSantaFe", kind: "PERCEPCION_IIBB_SANTA_FE", label: "Ing. Brutos Santa Fe" },
  { name: "percepcionIva", kind: "PERCEPCION_IVA", label: "Percepción IVA" },
  { name: "contribMunicipal", kind: "CONTRIBUCION_MUNICIPAL", label: "Contrib municipal" },
  { name: "contribProvincial", kind: "CONTRIBUCION_PROVINCIAL", label: "Contrib provincial" },
  { name: "rg3337", kind: "RG_3337", label: "RG 3337" },
  { name: "cef", kind: "CEF", label: "CEF" },
  { name: "otroTributo", kind: "OTRO_TRIBUTO", label: "Otro tributo" },
];

/** El comodín lleva además una descripción, para que el libro pueda decir de qué se trata. */
export const CAMPO_OTRO_TRIBUTO_DESC = "otroTributoDesc";

/** Lo que suma al neto en vez de al total: no gravado y exento no llevan IVA pero son base. */
const KINDS_NETO: TaxKind[] = ["NO_GRAVADO", "EXENTO"];

/** Todo lo que no es IVA ni base imponible suma al total como percepción. */
const esPercepcion = (kind: TaxKind) => kind !== "IVA" && !KINDS_NETO.includes(kind);

export type GastoTaxRow = {
  kind: TaxKind;
  /** Sólo para OTRO_TRIBUTO: de qué se trata. */
  description?: string | null;
  /** Neto gravado. Solo en las filas de IVA. */
  base: Prisma.Decimal | null;
  /** Alícuota en %. Solo en las filas de IVA. */
  rate: Prisma.Decimal | null;
  amount: Prisma.Decimal;
};

export type GastoTotals = {
  netAmount: Prisma.Decimal;
  /** La alícuota, solo si hay una sola fila de IVA. Con dos o más queda null: no hay una "la". */
  ivaRate: Prisma.Decimal | null;
  ivaAmount: Prisma.Decimal;
  perceptionAmount: Prisma.Decimal;
  retentionAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

/**
 * Resume el desglose en las columnas que ya tiene Document. Es lo que hace que el saldo, el estado
 * de cuenta y el Excel no se enteren de que existe la tabla de tributos.
 */
export function computeGastoTotals(
  rows: GastoTaxRow[],
  retentionAmount: Prisma.Decimal
): GastoTotals {
  const ivaRows = rows.filter((r) => r.kind === "IVA");
  const netoRows = rows.filter((r) => KINDS_NETO.includes(r.kind));
  const percepcionRows = rows.filter((r) => esPercepcion(r.kind));

  const netAmount = sumDecimals([
    ...ivaRows.map((r) => r.base),
    ...netoRows.map((r) => r.amount),
  ]);
  const ivaAmount = sumDecimals(ivaRows.map((r) => r.amount));
  const perceptionAmount = sumDecimals(percepcionRows.map((r) => r.amount));

  return {
    netAmount,
    ivaRate: ivaRows.length === 1 ? ivaRows[0].rate : null,
    ivaAmount,
    perceptionAmount,
    retentionAmount,
    totalAmount: netAmount.plus(ivaAmount).plus(perceptionAmount).minus(retentionAmount),
  };
}

/**
 * Lee el desglose tal como lo manda el formulario, tolerando texto a medio escribir: lo que no se
 * entiende vale cero. Lo usa el total en vivo del navegador; el servidor valida aparte con
 * `parseNumeroEscrito`, que sí tira error, antes de guardar.
 */
export function filasDesdeValores(valores: Record<string, string>): GastoTaxRow[] {
  const rows: GastoTaxRow[] = [];

  for (const alicuota of ALICUOTAS_IVA) {
    const base = parseNumeroSuave(valores[`ivaBase_${alicuota}`] ?? "") ?? ZERO;
    if (base.isZero()) continue;
    const rate = parseNumeroSuave(alicuota)!;
    rows.push({ kind: "IVA", base, rate, amount: base.times(rate).dividedBy(100) });
  }

  for (const tributo of OTROS_TRIBUTOS) {
    const amount = parseNumeroSuave(valores[tributo.name] ?? "") ?? ZERO;
    if (amount.isZero()) continue;
    rows.push({ kind: tributo.kind, base: null, rate: null, amount });
  }

  return rows;
}

/**
 * Lee del formulario todo lo que no depende de la base: cabecera, desglose y totales. Vive acá y no
 * en el archivo de acciones para poder probarlo con un FormData armado a mano, sin sesión ni base.
 *
 * A diferencia de `filasDesdeValores`, este parseo **tira `UserError`** ante un número ilegible: es
 * el que guarda, y un monto que entra como cero no se ve hasta que alguien concilia la cuenta.
 */
export function leerGastoDelForm(formData: FormData) {
  const circuitRaw = String(formData.get("circuit") || "");
  if (circuitRaw !== "BLANCO" && circuitRaw !== "NEGRO") throw new UserError("Cuenta inválida.");
  const circuit: Circuit = circuitRaw;

  const expenseCategoryRaw = String(formData.get("expenseCategory") || "");
  if (!(expenseCategoryRaw in EXPENSE_CATEGORY_LABELS)) throw new UserError("Elegí de qué es el gasto.");
  const expenseCategory = expenseCategoryRaw as ExpenseCategory;

  const currency = String(formData.get("currency") || "ARS") as Currency;
  const exchangeRateRaw = String(formData.get("exchangeRate") || "").trim();
  const exchangeRate =
    currency === "USD" && exchangeRateRaw ? parseNumeroEscrito(exchangeRateRaw, "cotización") : null;
  const reason = String(formData.get("reason") || "").trim() || null;

  const numberRaw = String(formData.get("number") || "").trim();
  // En negro no hay factura, así que tampoco número: se guarda "S/N" para que la fila igual tenga
  // cómo nombrarse. En blanco el número es el de la factura y no puede faltar.
  if (circuit === "BLANCO" && !numberRaw) throw new UserError("Falta el número de la factura.");
  const number = numberRaw || "S/N";

  let taxRows: GastoTaxRow[] = [];
  let totals: GastoTotals;

  if (circuit === "NEGRO") {
    const raw = String(formData.get("amount") || "").trim();
    if (!raw) throw new UserError("Falta el monto del gasto.");
    const amount = parseNumeroEscrito(raw, "monto");
    totals = {
      netAmount: amount,
      ivaRate: null,
      ivaAmount: ZERO,
      perceptionAmount: ZERO,
      retentionAmount: ZERO,
      totalAmount: amount,
    };
  } else {
    ({ taxRows, totals } = leerDesglose(formData));
    if (totals.totalAmount.isZero()) {
      throw new UserError("El gasto quedó en cero: cargá al menos un neto gravado o un no gravado.");
    }
  }

  return { circuit, expenseCategory, number, currency, exchangeRate, reason, taxRows, totals };
}

/**
 * Los tributos que puede traer una compra de insumos, además del IVA. A diferencia de un gasto no
 * lleva "no gravado" ni "exento": el neto de una compra sale de las líneas, no se escribe a mano.
 */
/** En una compra el neto sale de las líneas, pero el resto de los renglones es el mismo. */
export const PERCEPCIONES_COMPRA = OTROS_TRIBUTOS;

/**
 * Lee la grilla de impuestos tal como la manda cualquiera de los tres formularios: el neto abierto
 * por alícuota, el no gravado, las percepciones y la retención.
 */
export function leerDesglose(formData: FormData): { taxRows: GastoTaxRow[]; totals: GastoTotals } {
  const taxRows: GastoTaxRow[] = [];

  for (const alicuota of ALICUOTAS_IVA) {
    const base = parseNumeroOpcional(
      String(formData.get(`ivaBase_${alicuota}`) || ""),
      `neto gravado ${alicuota}%`
    );
    if (base.isZero()) continue;
    const rate = parseNumeroEscrito(alicuota, "alícuota");
    taxRows.push({ kind: "IVA", base, rate, amount: base.times(rate).dividedBy(100) });
  }

  for (const tributo of OTROS_TRIBUTOS) {
    const amount = parseNumeroOpcional(String(formData.get(tributo.name) || ""), tributo.label);
    if (amount.isZero()) continue;
    const description =
      tributo.kind === "OTRO_TRIBUTO"
        ? String(formData.get(CAMPO_OTRO_TRIBUTO_DESC) || "").trim() || null
        : null;
    if (tributo.kind === "OTRO_TRIBUTO" && !description) {
      throw new UserError("Decí de qué es ese otro tributo.");
    }
    taxRows.push({ kind: tributo.kind, base: null, rate: null, amount, description });
  }

  const retentionAmount = parseNumeroOpcional(
    String(formData.get("retentionAmount") || ""),
    "retención"
  );

  return { taxRows, totals: computeGastoTotals(taxRows, retentionAmount) };
}

/**
 * El desglose impositivo de una compra en Blanco. El neto no se escribe: es la suma de las líneas,
 * y el reparto por alícuota tiene que cerrar contra eso. En Negro no hay factura, así que el neto
 * ES el total.
 */
export function impuestosDeCompra(
  formData: FormData,
  neto: Prisma.Decimal,
  circuit: Circuit
): { taxRows: GastoTaxRow[]; totals: GastoTotals } {
  if (circuit === "NEGRO") {
    return {
      taxRows: [],
      totals: {
        netAmount: neto,
        ivaRate: null,
        ivaAmount: ZERO,
        perceptionAmount: ZERO,
        retentionAmount: ZERO,
        totalAmount: neto,
      },
    };
  }

  const leido = leerDesglose(formData);
  let taxRows = leido.taxRows;
  let totals = leido.totals;

  // Sin reparto cargado el neto entero va al 21%: es el caso normal y no vale la pena tipearlo.
  if (!taxRows.some((r) => r.kind === "IVA" || KINDS_NETO.includes(r.kind))) {
    const rate = parseNumeroEscrito(String(DEFAULT_IVA_RATE), "alícuota");
    taxRows = [{ kind: "IVA", base: neto, rate, amount: neto.times(rate).dividedBy(100) }, ...taxRows];
    totals = computeGastoTotals(taxRows, totals.retentionAmount);
  }

  // El reparto tiene que cerrar contra lo que realmente llegó: si no, el libro declara un neto que
  // no es el de la compra y nadie se entera hasta que el contador concilia.
  if (!totals.netAmount.equals(neto)) {
    const diferencia = totals.netAmount.minus(neto);
    throw new UserError(
      `El desglose suma ${formatMoney(totals.netAmount)} y las líneas de la compra suman ${formatMoney(neto)} — ` +
        `${diferencia.greaterThan(0) ? "sobran" : "faltan"} ${formatMoney(diferencia.abs())}.`
    );
  }

  return { taxRows, totals };
}

/**
 * El desglose de un comprobante con las mismas claves con las que lo manda el formulario, para que
 * editarlo sea reabrir lo que se cargó y no rearmarlo de memoria. Sirve para los tres: gasto,
 * compra y nota.
 */
export function desgloseDesdeDocumento(doc: {
  retentionAmount: Prisma.Decimal | null;
  taxes: {
    kind: TaxKind;
    base: Prisma.Decimal | null;
    rate: Prisma.Decimal | null;
    amount: Prisma.Decimal;
    description?: string | null;
  }[];
}): Record<string, string> {
  const valores: Record<string, string> = {};
  if (doc.retentionAmount && !doc.retentionAmount.isZero()) {
    valores.retentionAmount = doc.retentionAmount.toString();
  }
  for (const tax of doc.taxes) {
    if (tax.kind === "IVA") {
      const alicuota = ALICUOTAS_IVA.find((a) => tax.rate?.equals(a.replace(",", ".")));
      if (alicuota) valores[`ivaBase_${alicuota}`] = tax.base?.toString() ?? "";
      continue;
    }
    const campo = OTROS_TRIBUTOS.find((t) => t.kind === tax.kind);
    if (!campo) continue;
    valores[campo.name] = tax.amount.toString();
    if (tax.description) valores[CAMPO_OTRO_TRIBUTO_DESC] = tax.description;
  }
  return valores;
}

/**
 * El desglose de una nota de crédito o débito. En Blanco es un comprobante fiscal: se carga el neto
 * y el IVA va encima, igual que una factura o una compra. En Negro no hay comprobante —el monto es
 * el monto— y esas notas quedan fuera del libro de IVA.
 *
 * El ajuste manual no pasa por acá: no es un comprobante sino una corrección de saldo.
 */
export function impuestosDeNota(
  formData: FormData,
  circuit: Circuit
): { taxRows: GastoTaxRow[]; totals: GastoTotals } {
  if (circuit === "NEGRO") {
    const raw = String(formData.get("amount") || "").trim();
    if (!raw) throw new UserError("Falta el monto.");
    const amount = parseNumeroEscrito(raw, "monto");
    return {
      taxRows: [],
      totals: {
        netAmount: amount,
        ivaRate: null,
        ivaAmount: ZERO,
        perceptionAmount: ZERO,
        retentionAmount: ZERO,
        totalAmount: amount,
      },
    };
  }

  // En Blanco el neto vive en la grilla, abierto por alícuota, igual que en un gasto.
  const { taxRows, totals } = leerDesglose(formData);
  if (totals.netAmount.isZero()) {
    throw new UserError("Cargá el neto gravado de la nota.");
  }
  return { taxRows, totals };
}

