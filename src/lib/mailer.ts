import { UserError } from "@/lib/user-error";
import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Envío de mails por el SMTP de Gmail.
 *
 * Por qué Gmail y no un servicio tipo Resend: **ningún proveedor externo puede mandar
 * correctamente como `@gmail.com`**, porque no se puede verificar ese dominio. El mail saldría
 * con "via sendgrid.net" y con SPF/DKIM desalineados, o sea con boleto directo a spam. El SMTP
 * propio de Gmail es el único camino que produce mail autenticado desde esa dirección. La mejora
 * real a futuro es tener dominio propio, no cambiar de proveedor.
 *
 * Requiere verificación en dos pasos en la cuenta de Google y una "contraseña de aplicación"
 * (16 caracteres), no la contraseña normal.
 */

export type MailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new UserError(
      "Faltan GMAIL_USER y/o GMAIL_APP_PASSWORD: no hay credenciales para enviar el mail."
    );
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      // 465 con TLS implícito: un round trip menos que STARTTLS en 587, y Vercel deja ambos
      // abiertos (solo bloquea el 25). Nada de `service: "gmail"`, que esconde el puerto.
      port: 465,
      secure: true,
      auth: { user, pass },
      // Sin `pool`: sirve para volumen, y acá solo mantendría sockets que la plataforma va a
      // congelar apenas responda la función.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 15_000,
    });
  }

  return transporter;
}

export type SendMailInput = {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
};

/**
 * Manda el mail y espera a que termine. El `await` no es opcional: en serverless, cuando la
 * función responde el trabajo pendiente se congela, así que un envío "en segundo plano" no llega.
 */
export async function sendMail({ to, subject, html, text, attachments }: SendMailInput) {
  const user = process.env.GMAIL_USER!;
  return getTransporter().sendMail({
    // El from tiene que ser la misma dirección autenticada — Gmail reescribe o rechaza si no
    // coincide. El nombre visible sí es libre.
    from: `"MRT" <${user}>`,
    to: to.join(", "),
    subject,
    text,
    html,
    attachments,
  });
}
