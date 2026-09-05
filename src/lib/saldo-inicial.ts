import "server-only";
import type { Prisma } from "@prisma/client";
import { formatMoney, parseNumeroEscrito, sumDecimals, ZERO } from "@/lib/money";
import { UserError } from "@/lib/user-error";

/** Marca el AJUSTE que representa el saldo con el que arrancó la cuenta. */
const NUMERO_SALDO_INICIAL = "SALDO-INICIAL";

/**
 * Deja el saldo inicial de una cuenta en lo que dice el formulario: lo crea, lo corrige o lo borra.
 * Es un solo AJUSTE por cuenta, así que editarlo no toca ningún otro movimiento.
 *
 * Se niega a tocarlo si tiene pagos imputados encima por menos de lo que quedaría: el pendiente del
 * documento es `monto - imputado`, y bajarlo por debajo de lo ya imputado lo deja en negativo, que
 * es un saldo que no existe.
 */
export async function aplicarSaldoInicial(
  tx: Prisma.TransactionClient,
  accountId: string,
  raw: string,
  userId: string
) {
  const existente = await tx.document.findFirst({
    where: { accountId, type: "AJUSTE", number: NUMERO_SALDO_INICIAL },
    include: { allocations: true },
  });
  const imputado = sumDecimals(existente?.allocations.map((a) => a.amount) ?? []);
  const amount = raw.trim() ? parseNumeroEscrito(raw, "saldo inicial") : ZERO;

  if (amount.isZero()) {
    if (!existente) return;
    if (!imputado.isZero()) {
      throw new UserError(
        `No se puede borrar el saldo inicial: tiene ${formatMoney(imputado)} de pagos imputados. Desimputalos primero desde la cuenta corriente.`
      );
    }
    await tx.document.delete({ where: { id: existente.id } });
    return;
  }

  // Sin imputaciones no hay nada que proteger, y un saldo negativo (a favor) es legítimo: sin el
  // `!imputado.isZero()` la comparación contra cero lo rechazaba.
  if (existente && !imputado.isZero() && amount.lessThan(imputado)) {
    throw new UserError(
      `El saldo inicial no puede quedar en menos de ${formatMoney(imputado)}, que es lo que ya tiene imputado en pagos.`
    );
  }

  if (existente) {
    await tx.document.update({
      where: { id: existente.id },
      data: { netAmount: amount, totalAmount: amount },
    });
    return;
  }

  await tx.document.create({
    data: {
      accountId,
      type: "AJUSTE",
      number: NUMERO_SALDO_INICIAL,
      date: new Date(),
      currency: "ARS",
      netAmount: amount,
      totalAmount: amount,
      reason: "Saldo inicial",
      createdById: userId,
    },
  });
}
