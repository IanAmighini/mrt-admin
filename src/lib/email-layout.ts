import "server-only";

/**
 * Primitivos de HTML para mails. Sin librería de plantillas: el HTML de mail es un blanco lo
 * bastante acotado como para que una dependencia no aporte nada.
 *
 * Reglas que no son negociables si uno quiere que se vea bien en Gmail:
 * - Layout con `<table>` y estilos inline. Gmail descarta los `<style>` y todos los `<link>`.
 * - Nada de flex, grid, position ni fuentes web.
 * - **Nunca poner color de texto sin poner también color de fondo en el mismo elemento**: Gmail
 *   invierte los colores en modo oscuro y, si falta el fondo, deja texto oscuro sobre fondo
 *   oscuro. Tampoco conviene usar blanco y negro puros, que su inversor trata peor que los
 *   casi-neutros.
 * - Las variables CSS de la app no llegan nunca al inbox: los colores van hardcodeados acá.
 */

const COLORS = {
  fondo: "#f4f4f5",
  tarjeta: "#ffffff",
  texto: "#1f2933",
  suave: "#6b7280",
  borde: "#e5e7eb",
  acento: "#e9d200",
  alerta: "#b91c1c",
};

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/** Los nombres de clientes salen de la base y son entrada de usuario: es la única superficie de inyección. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Texto secundario dentro de una celda (segunda línea de una fila). Existe como helper para que
 * el fondo viaje siempre junto al color: un `<span>` con color y sin `background-color` es
 * exactamente lo que Gmail deja ilegible al invertir en modo oscuro.
 */
export function subtle(text: string): string {
  return `<br><span style="font-size:11px;color:${COLORS.suave};background-color:${COLORS.tarjeta};">${escapeHtml(text)}</span>`;
}

export function heading(text: string): string {
  return `<tr><td style="padding:24px 24px 8px 24px;background-color:${COLORS.tarjeta};">
    <h2 style="margin:0;font-family:${FONT};font-size:16px;font-weight:600;color:${COLORS.texto};background-color:${COLORS.tarjeta};">${escapeHtml(text)}</h2>
  </td></tr>`;
}

export function paragraph(text: string, muted = false): string {
  return `<tr><td style="padding:0 24px 12px 24px;background-color:${COLORS.tarjeta};">
    <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${muted ? COLORS.suave : COLORS.texto};background-color:${COLORS.tarjeta};">${text}</p>
  </td></tr>`;
}

/** Fila de números grandes, arriba de todo: lo accionable antes de cualquier scroll. */
export function kpiRow(kpis: { label: string; value: string; alerta?: boolean }[]): string {
  const cells = kpis
    .map(
      (kpi) => `<td width="${Math.floor(100 / kpis.length)}%" style="padding:8px;background-color:${COLORS.tarjeta};vertical-align:top;">
        <p style="margin:0 0 4px 0;font-family:${FONT};font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:${COLORS.suave};background-color:${COLORS.tarjeta};">${escapeHtml(kpi.label)}</p>
        <p style="margin:0;font-family:${FONT};font-size:20px;font-weight:700;color:${kpi.alerta ? COLORS.alerta : COLORS.texto};background-color:${COLORS.tarjeta};">${escapeHtml(kpi.value)}</p>
      </td>`
    )
    .join("");

  return `<tr><td style="padding:16px 16px 8px 16px;background-color:${COLORS.tarjeta};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.tarjeta};"><tr>${cells}</tr></table>
  </td></tr>`;
}

/** Tabla simple. Máximo 3 columnas: más que eso no se lee en un celular. */
export function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";

  const head = headers
    .map(
      (h, i) =>
        `<th align="${i === 0 ? "left" : "right"}" style="padding:6px 8px;border-bottom:1px solid ${COLORS.borde};font-family:${FONT};font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:${COLORS.suave};background-color:${COLORS.tarjeta};">${escapeHtml(h)}</th>`
    )
    .join("");

  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, i) =>
              `<td align="${i === 0 ? "left" : "right"}" style="padding:6px 8px;border-bottom:1px solid ${COLORS.borde};font-family:${FONT};font-size:13px;color:${COLORS.texto};background-color:${COLORS.tarjeta};">${cell}</td>`
          )
          .join("")}</tr>`
    )
    .join("");

  return `<tr><td style="padding:0 24px 16px 24px;background-color:${COLORS.tarjeta};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.tarjeta};">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </td></tr>`;
}

export function divider(): string {
  return `<tr><td style="padding:0 24px;background-color:${COLORS.tarjeta};">
    <div style="height:1px;background-color:${COLORS.borde};font-size:0;line-height:0;">&nbsp;</div>
  </td></tr>`;
}

/** Envuelve el contenido en la estructura exterior del mail. */
export function shell({ title, subtitle, body }: { title: string; subtitle: string; body: string }): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.fondo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.fondo};">
<tr><td align="center" style="padding:16px;background-color:${COLORS.fondo};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:${COLORS.tarjeta};border:1px solid ${COLORS.borde};border-radius:12px;overflow:hidden;">
    <tr><td style="height:4px;background-color:${COLORS.acento};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:20px 24px 4px 24px;background-color:${COLORS.tarjeta};">
      <h1 style="margin:0;font-family:${FONT};font-size:18px;font-weight:700;color:${COLORS.texto};background-color:${COLORS.tarjeta};">${escapeHtml(title)}</h1>
      <p style="margin:4px 0 0 0;font-family:${FONT};font-size:13px;color:${COLORS.suave};background-color:${COLORS.tarjeta};">${escapeHtml(subtitle)}</p>
    </td></tr>
    ${body}
    <tr><td style="padding:16px 24px 24px 24px;background-color:${COLORS.tarjeta};">
      <p style="margin:0;font-family:${FONT};font-size:11px;color:${COLORS.suave};background-color:${COLORS.tarjeta};">Enviado automáticamente por MRT — Sistema de Gestión.</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
