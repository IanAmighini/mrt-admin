import { Prisma, type Circuit, type Currency, type ExpenseCategory, type TaxKind } from "@prisma/client";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import {
  DEFAULT_IVA_RATE,
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

/** Los renglones que no son IVA: cada uno es un campo suelto del formulario. */
export const OTROS_TRIBUTOS: { name: string; kind: TaxKind; label: string }[] = [
  { name: "noGravado", kind: "NO_GRAVADO", label: "No gravado" },
  { name: "exento", kind: "EXENTO", label: "Exento" },
  { name: "percepcionIva", kind: "PERCEPCION_IVA", label: "Percepción IVA" },
  { name: "percepcionIibb", kind: "PERCEPCION_IIBB", label: "Percepción IIBB" },
  { name: "percepcionMunicipal", kind: "PERCEPCION_MUNICIPAL", label: "Percepción municipal" },
  { name: "impuestoInterno", kind: "IMPUESTO_INTERNO", label: "Impuestos internos" },
];

/** Los renglones que suman al total pero no al neto. Los otros (no gravado, exento) son neto. */
const KINDS_PERCEPCION: TaxKind[] = [
  "PERCEPCION_IVA",
  "PERCEPCION_IIBB",
  "PERCEPCION_MUNICIPAL",
  "IMPUESTO_INTERNO",
  "OTRO_TRIBUTO",
];

export type GastoTaxRow = {
  kind: TaxKind;
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
  const netoRows = rows.filter((r) => r.kind === "NO_GRAVADO" || r.kind === "EXENTO");
  const percepcionRows = rows.filter((r) => KINDS_PERCEPCION.includes(r.kind));

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

  const taxRows: GastoTaxRow[] = [];
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
      taxRows.push({ kind: tributo.kind, base: null, rate: null, amount });
    }
    const retentionAmount = parseNumeroOpcional(
      String(formData.get("retentionAmount") || ""),
      "retención"
    );
    totals = computeGastoTotals(taxRows, retentionAmount);

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
export const PERCEPCIONES_COMPRA = OTROS_TRIBUTOS.filter((t) => t.name.startsWith("percepcion"));

/**
 * El desglose impositivo de una compra en Blanco. El neto no se escribe: es la suma de las líneas,
 * y sobre eso se aplica la alícuota. En Negro no hay factura, así que el neto ES el total.
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

  const rate = parseNumeroEscrito(String(formData.get("ivaRate") || DEFAULT_IVA_RATE), "alícuota de IVA");
  const taxRows: GastoTaxRow[] = [
    { kind: "IVA", base: neto, rate, amount: neto.times(rate).dividedBy(100) },
  ];

  for (const tributo of PERCEPCIONES_COMPRA) {
    const amount = parseNumeroOpcional(String(formData.get(tributo.name) || ""), tributo.label);
    if (amount.isZero()) continue;
    taxRows.push({ kind: tributo.kind, base: null, rate: null, amount });
  }

  const retentionAmount = parseNumeroOpcional(
    String(formData.get("retentionAmount") || ""),
    "retención"
  );

  return { taxRows, totals: computeGastoTotals(taxRows, retentionAmount) };
}

/**
 * Devuelve los tributos de una compra con las mismas claves con las que los manda el formulario,
 * para que editarla sea reabrir lo que se cargó y no rearmarlo de memoria.
 */
export function impuestosDesdeDocumento(doc: {
  ivaRate: Prisma.Decimal | null;
  retentionAmount: Prisma.Decimal | null;
  taxes: { kind: TaxKind; amount: Prisma.Decimal }[];
}): Record<string, string> {
  const valores: Record<string, string> = {
    ivaRate: (doc.ivaRate ?? DEFAULT_IVA_RATE).toString(),
  };
  if (doc.retentionAmount && !doc.retentionAmount.isZero()) {
    valores.retentionAmount = doc.retentionAmount.toString();
  }
  for (const tax of doc.taxes) {
    const campo = PERCEPCIONES_COMPRA.find((t) => t.kind === tax.kind);
    if (campo) valores[campo.name] = tax.amount.toString();
  }
  return valores;
}
