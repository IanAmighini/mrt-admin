"use server";

import { revalidatePath } from "next/cache";
import type { ChequeEstado } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { UserError } from "@/lib/user-error";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { marcarCheque } from "@/lib/cheques";
import { CHEQUE_ESTADO_LABELS } from "@/lib/labels";
import { formatMoney, parseNumeroEscrito, sumDecimals } from "@/lib/money";

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

const ESTADOS_MANUALES: ChequeEstado[] = ["DEPOSITADO", "RECHAZADO", "EN_CARTERA"];

/** Depositar un cheque, o marcarlo rechazado. Entregarlo no se hace acá: eso es cargar el pago. */
export async function actualizarEstadoCheque(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const chequeId = String(formData.get("chequeId") || "");
  const estado = String(formData.get("estado") || "") as ChequeEstado;
  if (!ESTADOS_MANUALES.includes(estado)) throw new UserError("Estado inválido.");

  await marcarCheque(chequeId, estado);

  const cheque = await prisma.cheque.findUnique({ where: { id: chequeId } });
  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Cheque",
    entityId: chequeId,
    summary: `#${cheque?.numero ?? chequeId} — ${CHEQUE_ESTADO_LABELS[estado]}`,
  });

  revalidatePath("/tesoreria/cheques");
}

/**
 * Cambio de cheques por efectivo: le damos plata a otra empresa y nos da cheques. Es a la par, así
 * que el efectivo que sale de la caja es el total de los cheques que entran.
 *
 * Se registra como un ajuste que resta de la tesorería elegida —la plata salió de verdad— y los
 * cheques entran a la cartera colgados de ese movimiento, para poder deshacer las dos cosas juntas.
 */
export async function cambiarChequesPorEfectivo(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const treasuryId = String(formData.get("treasuryId") || "");
  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new UserError("Cuenta inválida.");

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId: treasuryId, circuit } },
    include: { entity: true },
  });
  if (!account || account.entity.type !== "TESORERIA") {
    throw new UserError("Elegí de qué caja sale el efectivo.");
  }

  const cambiadoA = String(formData.get("cambiadoA") || "").trim() || null;
  const date = parseFormDate(formData.get("date"));

  const numeros = formData.getAll("chequeNumero").map(String);
  const bancos = formData.getAll("chequeBanco").map(String);
  const montos = formData.getAll("chequeMonto").map(String);
  const fechas = formData.getAll("chequeFecha").map(String);

  const cheques = numeros
    .map((numero, i) => ({
      numero: numero.trim(),
      banco: (bancos[i] ?? "").trim() || null,
      montoRaw: (montos[i] ?? "").trim(),
      fechaRaw: (fechas[i] ?? "").trim(),
    }))
    .filter((c) => c.numero || c.montoRaw);

  if (cheques.length === 0) throw new UserError("Cargá al menos un cheque.");

  const data = cheques.map((c) => {
    if (!c.numero) throw new UserError("Falta el número de uno de los cheques.");
    return {
      numero: c.numero,
      banco: c.banco,
      amount: parseNumeroEscrito(c.montoRaw, `monto del cheque ${c.numero}`),
      fechaCobro: c.fechaRaw ? new Date(`${c.fechaRaw}T00:00:00`) : null,
    };
  });

  const total = sumDecimals(data.map((c) => c.amount));
  if (!total.greaterThan(0)) throw new UserError("El total de los cheques tiene que ser mayor a cero.");

  await prisma.$transaction(async (tx) => {
    const movimiento = await tx.document.create({
      data: {
        accountId: account.id,
        type: "AJUSTE",
        number: `CAMBIO-${Date.now().toString(36).toUpperCase()}`,
        date,
        currency: "ARS",
        // Negativo: la plata sale de la caja. Los cheques que entran no son plata todavía.
        netAmount: total,
        totalAmount: total.negated(),
        reason: `Cambio de ${data.length} cheque(s) por efectivo${cambiadoA ? ` — ${cambiadoA}` : ""}`,
        treasuryCategory: "OTRO",
        createdById: user.id,
      },
    });

    await tx.cheque.createMany({
      data: data.map((c) => ({
        ...c,
        estado: "EN_CARTERA" as const,
        cambiadoA,
        cambioEnId: movimiento.id,
        createdById: user.id,
      })),
    });

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Cambio de cheques",
      entityId: movimiento.id,
      summary: `${data.length} cheque(s) por ${formatMoney(total)}${cambiadoA ? ` — ${cambiadoA}` : ""}`,
    });
  });

  revalidatePath("/tesoreria/cheques");
  revalidatePath("/tesoreria");
}
