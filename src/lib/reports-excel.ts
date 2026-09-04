import "server-only";
import { Prisma, type Currency } from "@prisma/client";
import { ZERO } from "@/lib/money";
import {
  CIRCUIT_LABELS,
  DOCUMENT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  SUPPLIER_CATEGORY_LABELS,
} from "@/lib/labels";
import { sheet, type ExcelSheet } from "@/lib/excel";
import { slugify } from "@/lib/slug";
import { formatPeriodLabel, toDateInputValue, periodLastDay, type Period } from "@/lib/period";
import {
  REPORT_KEYS_SNAPSHOT,
  REPORT_LABELS,
  type CobranzasReport,
  type ComprasReport,
  type InsumosMinimoReport,
  type ProduccionReport,
  type ReportKey,
  type VencidosReport,
  type VentasReport,
} from "@/lib/reports";

/** Los importes por moneda se aplanan a ARS + una columna con el resto, para no explotar columnas. */
function ars(byCurrency: Map<Currency, Prisma.Decimal>): Prisma.Decimal {
  return byCurrency.get("ARS") ?? ZERO;
}

function otrasMonedas(byCurrency: Map<Currency, Prisma.Decimal>): string | null {
  const otras = Array.from(byCurrency.entries()).filter(([currency]) => currency !== "ARS");
  if (otras.length === 0) return null;
  return otras.map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`).join(" · ");
}

function periodSubtitle(period: Period, generatedAt: Date): string[] {
  return [
    `Período: ${formatPeriodLabel(period)}`,
    `Generado el ${generatedAt.toLocaleDateString("es-AR")}`,
  ];
}

// ---------------------------------------------------------------------------

function vencidosSheets(report: VencidosReport): ExcelSheet<never>[] {
  const subtitle = [
    `Al ${report.asOf.toLocaleDateString("es-AR")}`,
    "Incluye remitos y facturas con vencimiento pasado y saldo pendiente.",
  ];

  return [
    sheet<VencidosReport["rows"][number]>({
      name: "Detalle",
      title: "Remitos vencidos impagos",
      subtitle,
      columns: [
        { header: "Cliente", value: (r) => r.entityName, width: 32 },
        { header: "Comprobante", value: (r) => `${DOCUMENT_TYPE_LABELS[r.type]} #${r.number}`, width: 22 },
        { header: "Circuito", value: (r) => CIRCUIT_LABELS[r.circuit], width: 10 },
        { header: "Fecha", value: (r) => r.date, format: "date" },
        { header: "Vencimiento", value: (r) => r.dueDate, format: "date" },
        { header: "Días de atraso", value: (r) => r.diasAtraso, format: "integer", width: 14 },
        { header: "Tramo", value: (r) => r.bucket, width: 10 },
        { header: "Moneda", value: (r) => r.currency, width: 10 },
        { header: "Total", value: (r) => r.total, format: "money" },
        { header: "Pendiente", value: (r) => r.pendiente, format: "money" },
      ],
      rows: report.rows,
      totals: [
        "Totales",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        ars(report.totalPendiente),
      ],
    }),
    sheet<VencidosReport["porCliente"][number]>({
      name: "Por cliente",
      title: "Vencido por cliente",
      subtitle,
      columns: [
        { header: "Cliente", value: (r) => r.entityName, width: 32 },
        { header: "Comprobantes", value: (r) => r.count, format: "integer", width: 14 },
        { header: "Pendiente", value: (r) => r.pendiente, format: "money" },
      ],
      rows: report.porCliente,
      totals: ["Totales", report.rows.length, ars(report.totalPendiente)],
    }),
    sheet<VencidosReport["porBucket"][number]>({
      name: "Por tramo",
      title: "Vencido por tramo de atraso",
      subtitle,
      columns: [
        { header: "Tramo (días)", value: (r) => r.bucket, width: 14 },
        { header: "Comprobantes", value: (r) => r.count, format: "integer", width: 14 },
        { header: "Pendiente", value: (r) => r.pendiente, format: "money" },
      ],
      rows: report.porBucket,
    }),
  ];
}

// ---------------------------------------------------------------------------

function insumosMinimoSheets(report: InsumosMinimoReport): ExcelSheet<never>[] {
  const subtitle = [
    `Al ${report.asOf.toLocaleDateString("es-AR")}`,
    `${report.rows.length} de ${report.totalItems} insumos por debajo del mínimo.`,
    ...(report.itemsSinMinimo > 0
      ? [`${report.itemsSinMinimo} insumo(s) todavía no tienen mínimo configurado.`]
      : []),
  ];

  return [
    sheet<InsumosMinimoReport["rows"][number]>({
      name: "Detalle",
      title: "Insumos bajo el mínimo",
      subtitle,
      columns: [
        { header: "Insumo", value: (r) => r.itemName, width: 36 },
        { header: "Categoría", value: (r) => SUPPLIER_CATEGORY_LABELS[r.category], width: 22 },
        { header: "Unidad", value: (r) => r.unit, width: 10 },
        { header: "Stock actual", value: (r) => r.stock, format: "number", width: 14 },
        { header: "Mínimo", value: (r) => r.minStock, format: "number" },
        { header: "Faltante", value: (r) => r.faltante, format: "number" },
        { header: "Costo unitario", value: (r) => r.unitCost, format: "money", width: 16 },
        { header: "Costo reposición", value: (r) => r.costoReposicion, format: "money", width: 18 },
      ],
      rows: report.rows,
      totals: [
        "Totales",
        null,
        null,
        null,
        null,
        null,
        null,
        report.costoReposicionTotal,
      ],
    }),
    sheet<InsumosMinimoReport["porCategoria"][number]>({
      name: "Por categoría",
      title: "Faltantes por categoría",
      subtitle,
      columns: [
        { header: "Categoría", value: (r) => SUPPLIER_CATEGORY_LABELS[r.category], width: 24 },
        { header: "Insumos", value: (r) => r.count, format: "integer" },
        { header: "Costo reposición", value: (r) => r.costoReposicion, format: "money", width: 18 },
      ],
      rows: report.porCategoria,
      totals: ["Totales", report.rows.length, report.costoReposicionTotal],
    }),
  ];
}

// ---------------------------------------------------------------------------

function ventasSheets(report: VentasReport, generatedAt: Date): ExcelSheet<never>[] {
  const subtitle = [
    ...periodSubtitle(report.period, generatedAt),
    "Solo remitos de entrega — las facturas no se cuentan aparte para no duplicar.",
  ];

  const aggColumns = <T extends { pallets: Prisma.Decimal; litros: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }>() => [
    { header: "Pallets", value: (r: T) => r.pallets, format: "number" as const },
    { header: "Litros", value: (r: T) => r.litros, format: "number" as const },
    { header: "Importe ARS", value: (r: T) => ars(r.byCurrency), format: "money" as const, width: 16 },
    { header: "Otras monedas", value: (r: T) => otrasMonedas(r.byCurrency), width: 18 },
  ];

  return [
    sheet<VentasReport["porCliente"][number]>({
      name: "Por cliente",
      title: "Ventas / entregas por cliente",
      subtitle,
      columns: [{ header: "Cliente", value: (r) => r.entityName, width: 32 }, ...aggColumns<VentasReport["porCliente"][number]>()],
      rows: report.porCliente,
      totals: ["Totales", report.totales.pallets, report.totales.litros, ars(report.totales.byCurrency), otrasMonedas(report.totales.byCurrency)],
    }),
    sheet<VentasReport["porMarca"][number]>({
      name: "Por marca",
      title: "Ventas / entregas por marca",
      subtitle,
      columns: [{ header: "Marca", value: (r) => r.marca, width: 28 }, ...aggColumns<VentasReport["porMarca"][number]>()],
      rows: report.porMarca,
      totals: ["Totales", report.totales.pallets, report.totales.litros, ars(report.totales.byCurrency), otrasMonedas(report.totales.byCurrency)],
    }),
    sheet<VentasReport["porProducto"][number]>({
      name: "Por producto",
      title: "Ventas / entregas por producto",
      subtitle,
      columns: [{ header: "Producto", value: (r) => r.label, width: 40 }, ...aggColumns<VentasReport["porProducto"][number]>()],
      rows: report.porProducto,
    }),
    sheet<VentasReport["detalle"][number]>({
      name: "Detalle",
      title: "Detalle de entregas",
      subtitle,
      columns: [
        { header: "Fecha", value: (r) => r.date, format: "date" },
        { header: "Remito", value: (r) => `#${r.number}`, width: 14 },
        { header: "Cliente", value: (r) => r.entityName, width: 32 },
        { header: "Circuito", value: (r) => CIRCUIT_LABELS[r.circuit], width: 10 },
        { header: "Producto", value: (r) => r.productLabel, width: 40 },
        { header: "Pallets", value: (r) => r.pallets, format: "number" },
        { header: "Litros", value: (r) => r.litros, format: "number" },
        { header: "Precio unit.", value: (r) => r.unitPrice, format: "money" },
        { header: "Subtotal", value: (r) => r.subtotal, format: "money" },
        { header: "Moneda", value: (r) => r.currency, width: 10 },
      ],
      rows: report.detalle,
    }),
  ];
}

// ---------------------------------------------------------------------------

function cobranzasSheetsDeLado(report: CobranzasReport, generatedAt: Date): ExcelSheet<never>[] {
  const esCobro = report.lado === "CLIENTES";
  const entidadLabel = esCobro ? "Cliente" : "Proveedor";
  const sufijo = esCobro ? "cobranzas" : "pagos";
  const subtitle = periodSubtitle(report.period, generatedAt);

  return [
    sheet<CobranzasReport["rows"][number]>({
      name: `Detalle ${sufijo}`,
      title: esCobro ? "Cobranzas del período" : "Pagos a proveedores del período",
      subtitle,
      columns: [
        { header: "Fecha", value: (r) => r.date, format: "date" },
        { header: entidadLabel, value: (r) => r.entityName, width: 32 },
        { header: "Circuito", value: (r) => CIRCUIT_LABELS[r.circuit], width: 10 },
        { header: "Medio", value: (r) => PAYMENT_METHOD_LABELS[r.method], width: 16 },
        { header: "Moneda", value: (r) => r.currency, width: 10 },
        { header: "Monto", value: (r) => r.amount, format: "money" },
        { header: "Sin imputar", value: (r) => (r.sinImputar.isZero() ? null : r.sinImputar), format: "money" },
        { header: "Tesorería", value: (r) => r.tesoreria, width: 18 },
        { header: "Descripción", value: (r) => r.reference, width: 34 },
      ],
      rows: report.rows,
      totals: [null, "Totales", null, null, null, ars(report.totales), null, null, null],
    }),
    sheet<CobranzasReport["porMetodo"][number]>({
      name: `Medio de pago ${sufijo}`,
      title: `Por medio de pago — ${sufijo}`,
      subtitle,
      columns: [
        { header: "Medio", value: (r) => PAYMENT_METHOD_LABELS[r.method], width: 18 },
        { header: "Cantidad", value: (r) => r.count, format: "integer" },
        { header: "Importe ARS", value: (r) => ars(r.byCurrency), format: "money", width: 16 },
        { header: "Otras monedas", value: (r) => otrasMonedas(r.byCurrency), width: 18 },
      ],
      rows: report.porMetodo,
      totals: ["Totales", report.rows.length, ars(report.totales), otrasMonedas(report.totales)],
    }),
    sheet<CobranzasReport["porEntidad"][number]>({
      name: `Por ${entidadLabel.toLowerCase()}`,
      title: `Por ${entidadLabel.toLowerCase()}`,
      subtitle,
      columns: [
        { header: entidadLabel, value: (r) => r.entityName, width: 32 },
        { header: "Cantidad", value: (r) => r.count, format: "integer" },
        { header: "Importe ARS", value: (r) => ars(r.byCurrency), format: "money", width: 16 },
        { header: "Otras monedas", value: (r) => otrasMonedas(r.byCurrency), width: 18 },
      ],
      rows: report.porEntidad,
      totals: ["Totales", report.rows.length, ars(report.totales), otrasMonedas(report.totales)],
    }),
  ];
}

// ---------------------------------------------------------------------------

function comprasSheets(report: ComprasReport, generatedAt: Date): ExcelSheet<never>[] {
  const subtitle = periodSubtitle(report.period, generatedAt);

  return [
    sheet<ComprasReport["porProveedor"][number]>({
      name: "Por proveedor",
      title: "Compras por proveedor",
      subtitle,
      columns: [
        { header: "Proveedor", value: (r) => r.entityName, width: 32 },
        { header: "Comprobantes", value: (r) => r.count, format: "integer", width: 14 },
        { header: "Importe ARS", value: (r) => ars(r.byCurrency), format: "money", width: 16 },
        { header: "Otras monedas", value: (r) => otrasMonedas(r.byCurrency), width: 18 },
      ],
      rows: report.porProveedor,
      totals: ["Totales", null, ars(report.totales), otrasMonedas(report.totales)],
    }),
    sheet<ComprasReport["porCategoria"][number]>({
      name: "Por categoría",
      title: "Compras por tipo de insumo",
      subtitle,
      columns: [
        { header: "Categoría", value: (r) => SUPPLIER_CATEGORY_LABELS[r.category], width: 24 },
        {
          header: "Cantidades",
          value: (r) => Array.from(r.qtyByUnit.entries()).map(([unit, qty]) => `${qty.toFixed(2)} ${unit}`).join(" · "),
          width: 28,
        },
        { header: "Importe ARS", value: (r) => ars(r.byCurrency), format: "money", width: 16 },
        { header: "Otras monedas", value: (r) => otrasMonedas(r.byCurrency), width: 18 },
      ],
      rows: report.porCategoria,
      totals: ["Totales", null, ars(report.totales), otrasMonedas(report.totales)],
    }),
    sheet<ComprasReport["porInsumo"][number]>({
      name: "Por insumo",
      title: "Compras por insumo",
      subtitle,
      columns: [
        { header: "Insumo", value: (r) => r.itemName, width: 36 },
        { header: "Cantidad", value: (r) => r.quantity, format: "number" },
        { header: "Unidad", value: (r) => r.unit, width: 10 },
        { header: "Importe ARS", value: (r) => ars(r.byCurrency), format: "money", width: 16 },
        { header: "Otras monedas", value: (r) => otrasMonedas(r.byCurrency), width: 18 },
      ],
      rows: report.porInsumo,
    }),
    sheet<ComprasReport["detalle"][number]>({
      name: "Detalle",
      title: "Detalle de compras",
      subtitle,
      columns: [
        { header: "Fecha", value: (r) => r.date, format: "date" },
        { header: "Remito", value: (r) => `#${r.number}`, width: 14 },
        { header: "Proveedor", value: (r) => r.entityName, width: 32 },
        { header: "Circuito", value: (r) => CIRCUIT_LABELS[r.circuit], width: 10 },
        { header: "Insumo", value: (r) => r.itemName, width: 36 },
        { header: "Cantidad", value: (r) => r.quantity, format: "number" },
        { header: "Unidad", value: (r) => r.unit, width: 10 },
        { header: "Precio unit.", value: (r) => r.unitPrice, format: "money" },
        { header: "Subtotal", value: (r) => r.subtotal, format: "money" },
        { header: "Moneda", value: (r) => r.currency, width: 10 },
      ],
      rows: report.detalle,
    }),
  ];
}

// ---------------------------------------------------------------------------

function produccionSheets(report: ProduccionReport, generatedAt: Date): ExcelSheet<never>[] {
  const subtitle = periodSubtitle(report.period, generatedAt);
  const costoSubtitle =
    report.costoInsumos.itemsSinCosto > 0
      ? [...subtitle, `Atención: ${report.costoInsumos.itemsSinCosto} insumo(s) consumidos no tienen costo unitario cargado; el total es parcial.`]
      : subtitle;

  return [
    sheet<ProduccionReport["porProducto"][number]>({
      name: "Por producto",
      title: "Producción por producto",
      subtitle,
      columns: [
        { header: "Producto", value: (r) => r.label, width: 40 },
        { header: "Pallets", value: (r) => r.pallets, format: "number" },
        { header: "Botellas", value: (r) => r.botellas, format: "integer", width: 14 },
      ],
      rows: report.porProducto,
      totals: ["Totales", report.totalPallets, null],
    }),
    sheet<ProduccionReport["costoInsumos"]["porItem"][number]>({
      name: "Insumos consumidos",
      title: "Insumos consumidos en producción",
      subtitle: costoSubtitle,
      columns: [
        { header: "Insumo", value: (r) => r.item.name, width: 36 },
        { header: "Cantidad", value: (r) => r.cantidad, format: "number" },
        { header: "Unidad", value: (r) => r.item.unit, width: 10 },
        { header: "Costo unitario", value: (r) => r.item.unitCost, format: "money", width: 16 },
        { header: "Costo", value: (r) => r.costo, format: "money" },
      ],
      rows: report.costoInsumos.porItem,
      totals: ["Totales", null, null, null, report.costoInsumos.total],
    }),
  ];
}

// ---------------------------------------------------------------------------

export type ReportData =
  | { key: "remitos-vencidos"; report: VencidosReport }
  | { key: "insumos-bajo-minimo"; report: InsumosMinimoReport }
  | { key: "ventas"; report: VentasReport }
  /** Los dos lados, igual que la pantalla: cobranzas a clientes y pagos a proveedores. */
  | { key: "cobranzas"; clientes: CobranzasReport; proveedores: CobranzasReport }
  | { key: "compras"; report: ComprasReport }
  | { key: "produccion"; report: ProduccionReport };

export function buildReportSheets(data: ReportData, generatedAt = new Date()): ExcelSheet<never>[] {
  switch (data.key) {
    case "remitos-vencidos":
      return vencidosSheets(data.report);
    case "insumos-bajo-minimo":
      return insumosMinimoSheets(data.report);
    case "ventas":
      return ventasSheets(data.report, generatedAt);
    case "cobranzas":
      return [
        ...cobranzasSheetsDeLado(data.clientes, generatedAt),
        ...cobranzasSheetsDeLado(data.proveedores, generatedAt),
      ];
    case "compras":
      return comprasSheets(data.report, generatedAt);
    case "produccion":
      return produccionSheets(data.report, generatedAt);
  }
}

export function reportFilename(key: ReportKey, period: Period, asOf: Date): string {
  const slug = slugify(REPORT_LABELS[key]);
  if (REPORT_KEYS_SNAPSHOT.includes(key)) return `reporte_${slug}_al_${toDateInputValue(asOf)}.xlsx`;
  return `reporte_${slug}_${toDateInputValue(period.from)}_${toDateInputValue(periodLastDay(period))}.xlsx`;
}
