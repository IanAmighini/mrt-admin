import "server-only";
import type { Prisma } from "@prisma/client";
import { parseNumeroEscrito, ZERO } from "@/lib/money";
import { hoyComoFecha } from "@/lib/period";

/** Marca el AJUSTE que representa el saldo con el que arrancó la cuenta. */
export const NUMERO_SALDO_INICIAL = "SALDO-INICIAL";

/**
 * Deja el saldo inicial de una cuenta en lo que dice el formulario: lo crea, lo corrige o lo borra.
 * Es un solo AJUSTE por cuenta, así que editarlo no toca ningún otro movimiento.
 *
 * Los cobros que tenía imputados no lo traban: quien lo llama rehace las imputaciones de la cuenta
 * después (`reimputarEntidades`), y lo que sobre pasa a cancelar lo siguiente.
 */
export async function aplicarSaldoInicial(
  tx: Prisma.TransactionClient,
  accountId: string,
  raw: string,
  userId: string
) {
  const existente = await tx.document.findFirst({
    where: { accountId, type: "AJUSTE", number: NUMERO_SALDO_INICIAL },
  });
  // En la moneda de la cuenta. Se guardaba siempre en pesos, y en la de Cristian —que se lleva en
  // dólares— el saldo inicial quedó marcado como pesos: el número era de dólares, pero un pago en
  // dólares no lo encontraba para imputarle, porque la imputación busca comprobantes de su moneda.
  const cuenta = await tx.account.findUnique({
    where: { id: accountId },
    select: { entity: { select: { moneda: true } } },
  });
  const currency = cuenta?.entity.moneda ?? "ARS";
  const amount = raw.trim() ? parseNumeroEscrito(raw, "saldo inicial") : ZERO;

  if (amount.isZero()) {
    if (!existente) return;
    // Lo que tenía imputado se suelta; la reimputación lo vuelve a repartir.
    await tx.paymentAllocation.deleteMany({ where: { documentId: existente.id } });
    await tx.document.delete({ where: { id: existente.id } });
    return;
  }

  if (existente) {
    await tx.document.update({
      where: { id: existente.id },
      // Vencido desde que se cargó: es deuda de antes de la app (ver getVencidosReport).
      data: { netAmount: amount, totalAmount: amount, currency, dueDate: existente.dueDate ?? hoyComoFecha(existente.date) },
    });
    return;
  }

  await tx.document.create({
    data: {
      accountId,
      type: "AJUSTE",
      number: NUMERO_SALDO_INICIAL,
      date: new Date(),
      dueDate: hoyComoFecha(),
      currency,
      netAmount: amount,
      totalAmount: amount,
      reason: "Saldo inicial",
      createdById: userId,
    },
  });
}
