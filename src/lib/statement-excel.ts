import "server-only";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { sheet, type ExcelSheet } from "@/lib/excel";
import type { AccountStatement, StatementEntry } from "@/lib/account-statement";
import { periodLastDay, toDateInputValue } from "@/lib/period";

/** Fila del Excel: los movimientos del período más, si hay filtro, el "Saldo anterior" al inicio. */
type StatementRow = {
  date: Date | null;
  comprobante: string;
  detalle: string | null;
  moneda: string | null;
  debe: StatementEntry["debe"] | null;
  haber: StatementEntry["haber"] | null;
  saldo: StatementEntry["saldoAcumulado"];
};

function periodLabel(statement: AccountStatement): string {
  const { from, to } = statement.period;
  if (!from && !to) return "Período: todos los movimientos";
  const desde = from ? from.toLocaleDateString("es-AR") : "el inicio";
  const hasta = to ? periodLastDay({ from: from ?? to, to }).toLocaleDateString("es-AR") : "hoy";
  return `Período: ${desde} – ${hasta}`;
}

export function buildStatementSheets(statement: AccountStatement): ExcelSheet<never>[] {
  const rows: StatementRow[] = [];

  if (statement.period.from) {
    rows.push({
      date: statement.period.from,
      comprobante: "Saldo anterior",
      detalle: null,
      moneda: null,
      debe: null,
      haber: null,
      saldo: statement.saldoAnterior,
    });
  }

  for (const entry of statement.entries) {
    rows.push({
      date: entry.date,
      comprobante: entry.title,
      detalle: entry.subtitle,
      moneda: entry.currency,
      debe: entry.debe.isZero() ? null : entry.debe,
      haber: entry.haber.isZero() ? null : entry.haber,
      saldo: entry.saldoAcumulado,
    });
  }

  const subtitle = [
    `Circuito: ${CIRCUIT_LABELS[statement.account.circuit]}`,
    periodLabel(statement),
    `Generado el ${statement.generatedAt.toLocaleDateString("es-AR")}`,
  ];
  if (statement.currencies.length > 1) {
    subtitle.push(
      "Atención: la cuenta tiene movimientos en más de una moneda; el saldo es la suma aritmética."
    );
  }

  return [
    sheet<StatementRow>({
      name: "Movimientos",
      title: `Estado de cuenta — ${statement.entity.name}`,
      subtitle,
      columns: [
        { header: "Fecha", value: (r) => r.date, format: "date" },
        { header: "Comprobante", value: (r) => r.comprobante, width: 26 },
        { header: "Detalle", value: (r) => r.detalle, width: 55 },
        { header: "Moneda", value: (r) => r.moneda, width: 10 },
        { header: "Debe", value: (r) => r.debe, format: "money" },
        { header: "Haber", value: (r) => r.haber, format: "money" },
        { header: "Saldo acumulado", value: (r) => r.saldo, format: "money", width: 18 },
      ],
      rows,
      // La fila de "Saldo anterior", cuando existe, es la primera.
      boldRowIndexes: statement.period.from ? [0] : [],
      totals: [
        null,
        "Totales del período",
        null,
        null,
        statement.totalDebe,
        statement.totalHaber,
        statement.saldoFinal,
      ],
    }),
  ];
}

export function statementFilename(statement: AccountStatement): string {
  const { from, to } = statement.period;
  const circuito = CIRCUIT_LABELS[statement.account.circuit].toLowerCase();
  const rango =
    from || to
      ? `${from ? toDateInputValue(from) : "inicio"}_${to ? toDateInputValue(periodLastDay({ from: from ?? to, to })) : "hoy"}`
      : "completo";
  return `estado-cuenta_${statement.entity.slug}_${circuito}_${rango}.xlsx`;
}
