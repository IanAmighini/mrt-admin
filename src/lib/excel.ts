import "server-only";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

export type CellValue = string | number | Date | Prisma.Decimal | null | undefined;

export type CellFormat = "text" | "money" | "number" | "integer" | "date";

export type ExcelColumn<Row> = {
  header: string;
  value: (row: Row) => CellValue;
  format?: CellFormat;
  width?: number;
};

export type ExcelSheet<Row = never> = {
  /** Se sanea: máximo 31 caracteres y sin []:*?/\ — nunca usar un nombre de entidad acá. */
  name: string;
  title?: string;
  /** Líneas de contexto bajo el título: entidad, circuito, período, avisos. */
  subtitle?: string[];
  columns: ExcelColumn<Row>[];
  rows: Row[];
  /** Fila final en negrita; tiene que tener el mismo largo que `columns`. */
  totals?: CellValue[];
  /** Índices dentro de `rows` que van en negrita (ej. el "Saldo anterior"). */
  boldRowIndexes?: number[];
};

/** `sheet()` es identidad: existe solo para que TypeScript infiera `Row` por hoja. */
export function sheet<Row>(definition: ExcelSheet<Row>): ExcelSheet<never> {
  return definition as unknown as ExcelSheet<never>;
}

const NUMBER_FORMATS: Record<CellFormat, string | undefined> = {
  text: undefined,
  money: "#,##0.00",
  number: "#,##0.000",
  integer: "#,##0",
  date: "dd/mm/yyyy",
};

const DEFAULT_WIDTHS: Record<CellFormat, number> = {
  text: 22,
  money: 16,
  number: 14,
  integer: 10,
  date: 12,
};

/**
 * exceljs serializa las fechas en UTC, así que un `Date` que es medianoche local se guardaría
 * corrido un día. Se reconstruye la fecha de calendario (la que ve el usuario) como medianoche UTC.
 */
function toExcelDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function toCell(value: CellValue, format: CellFormat): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (value instanceof Date) return format === "date" ? toExcelDate(value) : value;
  return value;
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, "").trim() || "Hoja").slice(0, 31);
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ` (${n})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n++;
  }
  used.add(candidate);
  return candidate;
}

export async function buildWorkbook(sheets: ExcelSheet<never>[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Envasadora";
  workbook.created = new Date();

  const usedNames = new Set<string>();

  for (const def of sheets) {
    const ws = workbook.addWorksheet(sanitizeSheetName(def.name, usedNames));
    const columnCount = def.columns.length;

    if (def.title) {
      const row = ws.addRow([def.title]);
      row.font = { bold: true, size: 14 };
      if (columnCount > 1) ws.mergeCells(row.number, 1, row.number, columnCount);
    }
    for (const line of def.subtitle ?? []) {
      const row = ws.addRow([line]);
      row.font = { italic: true, color: { argb: "FF6B7280" } };
      if (columnCount > 1) ws.mergeCells(row.number, 1, row.number, columnCount);
    }
    if (def.title || def.subtitle?.length) ws.addRow([]);

    const headerRow = ws.addRow(def.columns.map((c) => c.header));
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
    });

    for (const [index, dataRow] of def.rows.entries()) {
      const row = ws.addRow(
        def.columns.map((c) => toCell(c.value(dataRow), c.format ?? "text"))
      );
      if (def.boldRowIndexes?.includes(index)) row.font = { bold: true };
    }

    if (def.totals) {
      const row = ws.addRow(
        def.totals.map((value, i) => toCell(value, def.columns[i]?.format ?? "text"))
      );
      row.font = { bold: true };
      row.eachCell((cell) => {
        cell.border = { top: { style: "thin", color: { argb: "FFD1D5DB" } } };
      });
    }

    def.columns.forEach((column, i) => {
      const format = column.format ?? "text";
      const col = ws.getColumn(i + 1);
      col.width = column.width ?? DEFAULT_WIDTHS[format];
      const numFmt = NUMBER_FORMATS[format];
      if (numFmt) {
        // Solo las filas de datos: el encabezado y el bloque de título son texto.
        for (let r = headerRow.number + 1; r <= ws.rowCount; r++) {
          ws.getCell(r, i + 1).numFmt = numFmt;
        }
      }
    });

    ws.views = [{ state: "frozen", ySplit: headerRow.number }];
    if (def.rows.length > 0) {
      ws.autoFilter = {
        from: { row: headerRow.number, column: 1 },
        to: { row: headerRow.number, column: columnCount },
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Respuesta de descarga, con el nombre en ASCII y además en UTF-8 (RFC 5987) por las dudas. */
export function excelResponse(body: Uint8Array, filename: string): Response {
  const asciiName = filename.normalize("NFD").replace(/[^\x20-\x7E]/g, "") || "export.xlsx";
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
