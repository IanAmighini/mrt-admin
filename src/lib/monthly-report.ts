import "server-only";
import type { Currency, Prisma } from "@prisma/client";
import { formatMoney, formatQuantity, ZERO } from "@/lib/money";
import { getSetting, setSetting } from "@/lib/settings";
import { formatFecha, lastMonthPeriod, toDateInputValue, type Period } from "@/lib/period";
import { getCierreReport, getCobranzasReport, getProduccionReport, getVentasReport } from "@/lib/reports";
import { getVentasDeInsumos } from "@/lib/dashboard-kpis";
import { buildReportSheets, reportFilename } from "@/lib/reports-excel";
import { buildWorkbook } from "@/lib/excel";
import { sendMail } from "@/lib/mailer";
import { divider, escapeHtml, heading, kpiRow, paragraph, shell, table } from "@/lib/email-layout";
import { getRecipients } from "@/lib/weekly-report";

export const SETTING_LAST_SENT_MONTH = "monthlyReportLastSentMonth";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export type MonthlyReportResult = { enviado: boolean; motivo?: string; destinatarios: string[]; mes: string };

const pesos = (porMoneda: Map<Currency, Prisma.Decimal>) => porMoneda.get("ARS") ?? ZERO;
const conSigno = (n: Prisma.Decimal) => `${n.isNegative() ? "−" : "+"} ${formatMoney(n.abs())}`;

/** "octubre 2026" del período: el mes de su primer día. */
function nombreDelMes(period: Period) {
  return `${MESES[period.from.getUTCMonth()]} ${period.from.getUTCFullYear()}`;
}

/**
 * El cierre del mes por mail, el 1° del mes siguiente: si se ganó o se perdió plata, cuánto se
 * envasó, si quedó más o menos producto terminado, cuánto se cobró y cuánto se entregó (pedido por
 * Ian el 28/10/2026). Va a los mismos destinatarios que el semanal, con el Excel del Cierre del mes.
 *
 * Los números son los del reporte «Cierre del mes» y los de Ventas, Cobranzas y Producción para el
 * mismo período: el mail no calcula nada propio, así lo que dice es lo que se ve en Reportes.
 */
export async function sendMonthlyReport(options?: {
  /** El mes a mandar. Por defecto, el anterior al de hoy: el job corre el 1°. */
  period?: Period;
  /** Saltea el guard de "ya enviado": lo usa el botón de enviar ahora. */
  force?: boolean;
}): Promise<MonthlyReportResult> {
  const period = options?.period ?? lastMonthPeriod();
  const mes = nombreDelMes(period);
  const mesKey = toDateInputValue(period.from).slice(0, 7);

  const destinatarios = await getRecipients();
  if (destinatarios.length === 0) return { enviado: false, motivo: "sin destinatarios", destinatarios, mes };

  if (!options?.force && (await getSetting(SETTING_LAST_SENT_MONTH, "")) === mesKey) {
    return { enviado: false, motivo: "ya enviado", destinatarios, mes };
  }

  const email = await buildMonthlyReportEmail(period);
  await sendMail({ to: destinatarios, ...email });

  // Después del envío: si falla, el próximo intento lo vuelve a mandar.
  await setSetting(SETTING_LAST_SENT_MONTH, mesKey);
  return { enviado: true, destinatarios, mes };
}

/** Arma el mail sin mandarlo, para poder mirarlo y probarlo sin credenciales. */
export async function buildMonthlyReportEmail(period: Period) {
  const mes = nombreDelMes(period);
  const [cierre, ventas, cobranzas, produccion, ventasDeInsumos] = await Promise.all([
    getCierreReport(period),
    getVentasReport(period),
    getCobranzasReport(period, "CLIENTES"),
    getProduccionReport(period),
    getVentasDeInsumos(period),
  ]);

  const { resultado, producto, insumos } = cierre;
  const gano = !resultado.resultado.isNegative();
  const difPallets = producto.pallets.cierre.minus(producto.pallets.inicio);
  const difProducto = producto.cierre.minus(producto.inicio);
  const difInsumos = insumos.cierre.minus(insumos.inicio);
  const ini = formatFecha(cierre.inicio);
  const fin = formatFecha(cierre.cierre);
  const cobrado = pesos(cobranzas.totales);
  const entregado = pesos(ventas.totales.byCurrency);
  // Enteros: las cajas sueltas hacen fracciones de pallet ("443,314") que en un mail no dicen nada.
  const pallets = (n: Prisma.Decimal) => {
    const redondo = n.toDecimalPlaces(0);
    return `${formatQuantity(redondo)} ${redondo.abs().equals(1) ? "pallet" : "pallets"}`;
  };
  const litros = formatQuantity(produccion.litrosEnvasados.toDecimalPlaces(0), "L");

  const bloques: string[] = [
    kpiRow([
      { label: gano ? "Se ganó" : "Se perdió", value: formatMoney(resultado.resultado.abs()), alerta: !gano },
      { label: "Envasado", value: pallets(produccion.totalPallets) },
      { label: "Cobrado", value: formatMoney(cobrado) },
    ]),
    divider(),
    heading("Resultado"),
    table(
      ["Concepto", "Importe"],
      [
        ["Ventas", escapeHtml(formatMoney(resultado.ventas))],
        ["Costo de lo vendido", escapeHtml(`− ${formatMoney(resultado.costo)}`)],
        ["Margen", escapeHtml(formatMoney(resultado.margen))],
        ["Gastos", escapeHtml(`− ${formatMoney(resultado.gastos)}`)],
        [`<strong>${gano ? "Ganancia" : "Pérdida"}</strong>`, `<strong>${escapeHtml(conSigno(resultado.resultado))}</strong>`],
      ]
    ),
    divider(),
    heading("Lo que se movió"),
    table(
      ["Concepto", "Cantidad", "Importe"],
      [
        ["Envasado", escapeHtml(pallets(produccion.totalPallets)), escapeHtml(litros)],
        ["Mercadería entregada", escapeHtml(pallets(ventas.totales.pallets)), escapeHtml(formatMoney(entregado))],
        // Va en las ventas del resultado pero no es mercadería: sin este renglón no cuadran.
        ["Insumos vendidos", `${ventasDeInsumos.cantidad}`, escapeHtml(formatMoney(ventasDeInsumos.ventas))],
        ["Cobrado a clientes", `${cobranzas.rows.length}`, escapeHtml(formatMoney(cobrado))],
      ]
    ),
    divider(),
    heading("Stock"),
    table(
      ["", `Al ${ini}`, `Al ${fin}`, "Diferencia"],
      [
        [
          "Producto terminado (pallets)",
          escapeHtml(formatQuantity(producto.pallets.inicio)),
          escapeHtml(formatQuantity(producto.pallets.cierre)),
          escapeHtml(`${difPallets.isNegative() ? "−" : "+"} ${formatQuantity(difPallets.abs())}`),
        ],
        [
          "Producto terminado (valor)",
          escapeHtml(formatMoney(producto.inicio)),
          escapeHtml(formatMoney(producto.cierre)),
          escapeHtml(conSigno(difProducto)),
        ],
        ["Insumos (valor)", escapeHtml(formatMoney(insumos.inicio)), escapeHtml(formatMoney(insumos.cierre)), escapeHtml(conSigno(difInsumos))],
      ]
    ),
    paragraph(
      `${difPallets.isNegative() ? "Quedó menos" : difPallets.isZero() ? "Quedó lo mismo de" : "Quedó más"} producto terminado que al empezar el mes. Lo comprado y no vendido no es pérdida: está en el depósito. El detalle, insumo por insumo, va en el Excel adjunto.`,
      true
    ),
  ];

  const html = shell({ title: `Cierre de ${mes}`, subtitle: `MRT · del ${formatFecha(period.from)} al ${fin}`, body: bloques.join("\n") });
  const text = [
    `MRT — Cierre de ${mes}`,
    "",
    `${gano ? "Se ganaron" : "Se perdieron"} ${formatMoney(resultado.resultado.abs())}: ventas ${formatMoney(resultado.ventas)}, costo de lo vendido ${formatMoney(resultado.costo)}, gastos ${formatMoney(resultado.gastos)}.`,
    `Envasado: ${pallets(produccion.totalPallets)} (${litros}).`,
    `Mercadería entregada: ${pallets(ventas.totales.pallets)} por ${formatMoney(entregado)}. Insumos vendidos: ${formatMoney(ventasDeInsumos.ventas)}. Cobrado a clientes: ${formatMoney(cobrado)}.`,
    `Producto terminado: de ${formatQuantity(producto.pallets.inicio)} a ${formatQuantity(producto.pallets.cierre)} pallets (${conSigno(difProducto)}). Insumos: ${conSigno(difInsumos)}.`,
    "",
    "El detalle va en el Excel adjunto.",
  ].join("\n");

  const bytes = await buildWorkbook(buildReportSheets({ key: "cierre-mes", report: cierre }, new Date()));
  return {
    subject: `MRT · Cierre de ${mes} — ${gano ? "se ganaron" : "se perdieron"} ${formatMoney(resultado.resultado.abs())}`,
    html,
    text,
    attachments: [
      {
        filename: reportFilename("cierre-mes", period, cierre.cierre),
        content: Buffer.from(bytes),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  };
}
