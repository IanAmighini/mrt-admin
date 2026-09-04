import "server-only";
import type { Currency, Prisma } from "@prisma/client";
import { formatMoney, formatQuantity, ZERO } from "@/lib/money";
import { PEDIDO_STATUS_LABELS, SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { getSetting, setSetting } from "@/lib/settings";
import {
  addDays,
  formatPeriodLabel,
  monthPeriod,
  startOfDay,
  toDateInputValue,
  weekPeriod,
  type Period,
} from "@/lib/period";
import {
  getCobranzasReport,
  getComprasReport,
  getInsumosMinimoReport,
  getProduccionReport,
  getVencidosReport,
  getVentasReport,
} from "@/lib/reports";
import { getAllPedidosPendientes } from "@/lib/pedidos";
import { buildReportSheets, reportFilename } from "@/lib/reports-excel";
import { buildWorkbook } from "@/lib/excel";
import { sendMail, type MailAttachment } from "@/lib/mailer";
import { divider, escapeHtml, heading, kpiRow, paragraph, shell, subtle, table } from "@/lib/email-layout";

export const SETTING_RECIPIENTS = "weeklyReportRecipients";
export const SETTING_LAST_SENT_WEEK = "weeklyReportLastSentWeek";
export const SETTING_LAST_RUN = "weeklyReportLastRunAt";

export type WeeklyReportResult = {
  enviado: boolean;
  motivo?: string;
  destinatarios: string[];
  semana: string;
};

export async function getRecipients(): Promise<string[]> {
  const raw = await getSetting(SETTING_RECIPIENTS, process.env.WEEKLY_REPORT_RECIPIENTS ?? "");
  return Array.from(
    new Set(
      raw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    )
  );
}

export type LastRunInfo = { at: Date; resultado: string };

/** Se guarda como JSON para poder mostrar el instante en horario argentino al leerlo. */
async function recordRun(at: Date, resultado: string) {
  await setSetting(SETTING_LAST_RUN, JSON.stringify({ at: at.toISOString(), resultado }));
}

export async function getLastRunInfo(): Promise<LastRunInfo | null> {
  const value = await getSetting(SETTING_LAST_RUN, "");
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { at: string; resultado: string };
    return { at: new Date(parsed.at), resultado: parsed.resultado };
  } catch {
    return null;
  }
}

function moneyArs(byCurrency: Map<Currency, Prisma.Decimal>): Prisma.Decimal {
  return byCurrency.get("ARS") ?? ZERO;
}

/** Sufijo "· USD 1.234,00" cuando además de pesos hay otras monedas, para no esconderlas. */
function otrasMonedas(byCurrency: Map<Currency, Prisma.Decimal>): string {
  const otras = Array.from(byCurrency.entries()).filter(([c]) => c !== "ARS");
  if (otras.length === 0) return "";
  return ` · ${otras.map(([c, v]) => `${c} ${v.toFixed(2)}`).join(" · ")}`;
}

export type WeeklyReportEmail = {
  subject: string;
  html: string;
  text: string;
  attachment: MailAttachment;
  semana: string;
  semanaKey: string;
};

/**
 * El job corre el lunes, así que weekPeriod(hoy) es la semana que ARRANCA hoy: la que hay que
 * reportar es la anterior. Se expone la etiqueta para ponerla en el asunto y que un error de
 * cuenta se vea el primer lunes, no dentro de tres meses.
 */
function semanaReportada(asOf: Date) {
  const period = weekPeriod(addDays(startOfDay(asOf), -7));
  return { period, semana: formatPeriodLabel(period), semanaKey: toDateInputValue(period.from) };
}

/**
 * Arma el mail sin mandarlo. Separado del envío para poder previsualizarlo y probarlo sin
 * credenciales de Gmail.
 */
export async function buildWeeklyReportEmail(asOf: Date = new Date()): Promise<WeeklyReportEmail> {
  const { period, semana, semanaKey } = semanaReportada(asOf);
  return buildEmailBody({ asOf, period, semana, semanaKey });
}

/**
 * Arma y manda el resumen semanal.
 *
 * **Siempre manda, aunque esté todo en cero.** El silencio tiene que significar "se rompió", no
 * "semana tranquila": una vez que alguien espera el mail los lunes, que no llegue es la alarma más
 * barata y confiable que hay.
 */
export async function sendWeeklyReport(options?: {
  asOf?: Date;
  /** Saltea el guard de "ya enviado" — lo usa el botón de enviar ahora. */
  force?: boolean;
}): Promise<WeeklyReportResult> {
  const asOf = options?.asOf ?? new Date();
  const { semana, semanaKey } = semanaReportada(asOf);

  const destinatarios = await getRecipients();
  if (destinatarios.length === 0) {
    // Una configuración incompleta no tiene que sonar como caída todos los lunes.
    await recordRun(asOf, "sin destinatarios");
    return { enviado: false, motivo: "sin destinatarios", destinatarios, semana };
  }

  if (!options?.force) {
    const yaEnviada = await getSetting(SETTING_LAST_SENT_WEEK, "");
    if (yaEnviada === semanaKey) {
      return { enviado: false, motivo: "ya enviado", destinatarios, semana };
    }
  }

  const email = await buildWeeklyReportEmail(asOf);

  try {
    await sendMail({
      to: destinatarios,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [email.attachment],
    });
  } catch (error) {
    await recordRun(asOf, `error: ${error instanceof Error ? error.message : "desconocido"}`);
    throw error;
  }

  // Se marca la semana DESPUÉS del envío exitoso, para que un fallo se pueda reintentar.
  await setSetting(SETTING_LAST_SENT_WEEK, semanaKey);
  await recordRun(asOf, `enviado a ${destinatarios.length} destinatario(s)`);

  return { enviado: true, destinatarios, semana };
}

/** El cuerpo del mail: todo lo que se consulta, se arma y se adjunta. */
async function buildEmailBody({
  asOf,
  period,
  semana,
  semanaKey,
}: {
  asOf: Date;
  period: Period;
  semana: string;
  semanaKey: string;
}): Promise<WeeklyReportEmail> {
  const [vencidos, insumos, pedidos, ventas, cobranzas, pagos, compras, produccion] =
    await Promise.all([
      getVencidosReport({ asOf }),
      getInsumosMinimoReport({ asOf }),
      getAllPedidosPendientes(),
      getVentasReport(period),
      getCobranzasReport(period, "CLIENTES"),
      getCobranzasReport(period, "PROVEEDORES"),
      getComprasReport(period),
      getProduccionReport(period),
    ]);

  const totalVencido = moneyArs(vencidos.totalPendiente);
  const bloques: string[] = [];

  // --- Arriba de todo: lo accionable, antes de cualquier scroll ---
  bloques.push(
    kpiRow([
      { label: "Vencido", value: formatMoney(totalVencido), alerta: vencidos.rows.length > 0 },
      { label: "Bajo mínimo", value: String(insumos.rows.length), alerta: insumos.rows.length > 0 },
      { label: "Pedidos", value: String(pedidos.length) },
    ])
  );

  // --- 1. Vencidos ---
  bloques.push(divider(), heading("Vencidos impagos"));
  if (vencidos.rows.length === 0) {
    bloques.push(paragraph("No hay comprobantes vencidos impagos.", true));
  } else {
    bloques.push(
      paragraph(
        `${escapeHtml(formatMoney(totalVencido))}${escapeHtml(otrasMonedas(vencidos.totalPendiente))} en ${vencidos.rows.length} comprobante(s), de ${vencidos.clientesAfectados} cliente(s). Atraso máximo: ${vencidos.atrasoMaximo} días.`
      ),
      paragraph(
        vencidos.porBucket.map((b) => `${escapeHtml(b.bucket)}: ${b.count}`).join(" · "),
        true
      ),
      table(
        ["Cliente", "Comprob.", "Pendiente"],
        vencidos.porCliente
          .slice(0, 5)
          .map((c) => [escapeHtml(c.entityName), String(c.count), escapeHtml(formatMoney(c.pendiente))])
      )
    );
    if (vencidos.porCliente.length > 5) {
      bloques.push(paragraph(`y ${vencidos.porCliente.length - 5} cliente(s) más — detalle completo en el Excel adjunto.`, true));
    } else {
      bloques.push(paragraph("Detalle completo en el Excel adjunto.", true));
    }
  }

  // --- 2. Insumos bajo mínimo ---
  bloques.push(divider(), heading("Insumos bajo el mínimo"));
  if (insumos.rows.length === 0) {
    bloques.push(paragraph("Ningún insumo está por debajo de su mínimo.", true));
  } else {
    bloques.push(
      table(
        ["Insumo", "Stock", "Mínimo"],
        insumos.rows
          .slice(0, 10)
          .map((r) => [
            `${escapeHtml(r.itemName)}${subtle(SUPPLIER_CATEGORY_LABELS[r.category])}`,
            escapeHtml(formatQuantity(r.stock, r.unit)),
            escapeHtml(formatQuantity(r.minStock, r.unit)),
          ])
      )
    );
  }
  if (insumos.itemsSinMinimo > 0) {
    bloques.push(
      paragraph(`${insumos.itemsSinMinimo} insumo(s) no tienen mínimo configurado y no se controlan.`, true)
    );
  }

  // --- 3. Pedidos pendientes ---
  bloques.push(divider(), heading("Pedidos pendientes"));
  if (pedidos.length === 0) {
    bloques.push(paragraph("No hay pedidos pendientes.", true));
  } else {
    const conAntiguedad = pedidos
      .map((p) => ({
        pedido: p,
        dias: Math.floor((asOf.getTime() - p.date.getTime()) / (24 * 60 * 60 * 1000)),
        pallets: p.lines.reduce((acc, l) => acc.plus(l.pallets), ZERO),
      }))
      .sort((a, b) => b.dias - a.dias);

    bloques.push(
      table(
        ["Cliente / pedido", "Pallets", "Antigüedad"],
        conAntiguedad
          .slice(0, 8)
          .map((r) => [
            `${escapeHtml(r.pedido.entity.name)}${subtle(`#${r.pedido.orderNumber} · ${PEDIDO_STATUS_LABELS[r.pedido.status]}`)}`,
            escapeHtml(formatQuantity(r.pallets)),
            `${r.dias} días`,
          ])
      )
    );
    if (conAntiguedad.length > 8) {
      bloques.push(paragraph(`y ${conAntiguedad.length - 8} pedido(s) más.`, true));
    }
  }

  // --- 4. Resumen de la semana (retrospectivo, va último) ---
  bloques.push(divider(), heading(`Semana del ${semana}`));
  bloques.push(
    table(
      ["Concepto", "Cantidad", "Importe"],
      [
        [
          "Entregas",
          escapeHtml(`${formatQuantity(ventas.totales.pallets)} pallets`),
          escapeHtml(formatMoney(moneyArs(ventas.totales.byCurrency))),
        ],
        ["Cobranzas", `${cobranzas.rows.length}`, escapeHtml(formatMoney(moneyArs(cobranzas.totales)))],
        ["Pagos a proveedores", `${pagos.rows.length}`, escapeHtml(formatMoney(moneyArs(pagos.totales)))],
        ["Compras", `${compras.detalle.length}`, escapeHtml(formatMoney(moneyArs(compras.totales)))],
        [
          "Producción",
          escapeHtml(`${formatQuantity(produccion.totalPallets)} pallets`),
          escapeHtml(formatQuantity(produccion.litrosEnvasados, "L")),
        ],
      ]
    )
  );

  const html = shell({
    title: "Resumen semanal",
    subtitle: `MRT · semana del ${semana}`,
    body: bloques.join("\n"),
  });

  // El texto plano no se genera despojando el HTML: es lo que se ve en la vista previa del inbox,
  // así que arranca con lo importante.
  const text = [
    `MRT — Resumen semanal (semana del ${semana})`,
    "",
    `Vencido: ${formatMoney(totalVencido)} en ${vencidos.rows.length} comprobante(s), ${vencidos.clientesAfectados} cliente(s).`,
    `Insumos bajo mínimo: ${insumos.rows.length}${insumos.itemsSinMinimo > 0 ? ` (${insumos.itemsSinMinimo} sin mínimo configurado)` : ""}.`,
    `Pedidos pendientes: ${pedidos.length}.`,
    "",
    `Semana pasada — entregas: ${formatQuantity(ventas.totales.pallets)} pallets por ${formatMoney(moneyArs(ventas.totales.byCurrency))}.`,
    `Cobrado: ${formatMoney(moneyArs(cobranzas.totales))} · Pagado: ${formatMoney(moneyArs(pagos.totales))} · Comprado: ${formatMoney(moneyArs(compras.totales))}.`,
    `Producción: ${formatQuantity(produccion.totalPallets)} pallets, ${formatQuantity(produccion.litrosEnvasados, "L")}.`,
    "",
    "El detalle de vencidos va en el Excel adjunto.",
  ].join("\n");

  const asunto =
    vencidos.rows.length > 0 || insumos.rows.length > 0
      ? `MRT · Semana del ${semana} — ${formatMoney(totalVencido)} vencido, ${insumos.rows.length} insumo(s) bajo mínimo`
      : `MRT · Semana del ${semana} — sin novedades`;

  // buildWorkbook devuelve bytes y no sabe nada de HTTP, así que va derecho al adjunto.
  const bytes = await buildWorkbook(buildReportSheets({ key: "remitos-vencidos", report: vencidos }, asOf));

  return {
    subject: asunto,
    html,
    text,
    attachment: {
      filename: reportFilename("remitos-vencidos", monthPeriod(asOf), asOf),
      content: Buffer.from(bytes),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    semana,
    semanaKey,
  };
}
