import "server-only";
import { formatFecha, parseFecha } from "@/lib/period";
import { Prisma, type ChequeEstado } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/user-error";
import { formatMoney, formatNumeroEditable, parseNumeroEscrito, sumDecimals } from "@/lib/money";

const CHEQUE_METHODS = ["CHEQUE", "ECHEQ"] as const;
export const esMetodoCheque = (method: string) =>
  (CHEQUE_METHODS as readonly string[]).includes(method);

/** Los cheques disponibles para entregarle a un proveedor. */
export async function getCartera() {
  return prisma.cheque.findMany({
    where: { estado: "EN_CARTERA" },
    include: { recibidoEn: { include: { account: { include: { entity: true } } } } },
    orderBy: [{ fechaCobro: "asc" }, { numero: "asc" }],
  });
}

/**
 * Crea el cheque que entró con un cobro. Es el único momento en que un cheque nace: después sólo
 * cambia de manos.
 */
export async function crearChequeRecibido(
  tx: Prisma.TransactionClient,
  params: {
    paymentId: string;
    formData: FormData;
    amount: Prisma.Decimal;
    esEcheq: boolean;
    userId: string;
    /** Un cheque que se carga al pagar nace ya entregado: no pasó por la cartera. */
    yaEntregado?: boolean;
  }
) {
  const numero = String(params.formData.get("chequeNumero") || "").trim();
  if (!numero) throw new UserError("Falta el número del cheque.");

  const banco = String(params.formData.get("chequeBanco") || "").trim() || null;
  const fechaRaw = String(params.formData.get("chequeFechaCobro") || "").trim();

  await tx.cheque.create({
    data: {
      numero,
      banco,
      esEcheq: params.esEcheq,
      amount: params.amount,
      // Sin fecha es un cheque al día: se puede cobrar desde que se recibió.
      fechaCobro: fechaRaw ? parseFecha(fechaRaw) : null,
      estado: params.yaEntregado ? "ENTREGADO" : "EN_CARTERA",
      // Al pagar, el cheque queda del lado de la salida; al cobrar, del lado de la entrada.
      ...(params.yaEntregado
        ? { entregadoEnId: params.paymentId }
        : { recibidoEnId: params.paymentId }),
      createdById: params.userId,
    },
  });
}

/**
 * Marca como entregado el cheque que se usó para pagarle a un proveedor. El monto del pago tiene
 * que ser el del cheque: un cheque se entrega entero, no en partes.
 */
export async function entregarCheques(
  tx: Prisma.TransactionClient,
  params: { paymentId: string; chequeIds: string[]; amount: Prisma.Decimal }
) {
  const ids = Array.from(new Set(params.chequeIds));
  const cheques = await tx.cheque.findMany({ where: { id: { in: ids } } });
  if (cheques.length !== ids.length) throw new UserError("Alguno de los cheques elegidos ya no existe.");

  const fuera = cheques.find((c) => c.estado !== "EN_CARTERA");
  if (fuera) throw new UserError(`El cheque #${fuera.numero} ya no está en cartera.`);

  // Los cheques se entregan enteros, así que el pago es exactamente lo que suman. Si no coincide,
  // es que se eligió uno de más o de menos —o el monto se tocó a mano—, y conviene que se vea.
  const total = sumDecimals(cheques.map((c) => c.amount));
  if (!total.equals(params.amount)) {
    throw new UserError(
      `Los cheques elegidos suman ${formatMoney(total)} y el pago es por ${formatMoney(params.amount)}: un cheque se entrega entero, así que el pago tiene que ser lo que suman.`
    );
  }

  await tx.cheque.updateMany({
    where: { id: { in: ids } },
    data: { estado: "ENTREGADO", entregadoEnId: params.paymentId },
  });
}

/**
 * Deshace el lado de salida de un pago que se está borrando o editando.
 *
 * Un cheque que había entrado por un cobro vuelve a la cartera: la FK lo desvincula sola
 * (`SetNull`), pero el estado no vuelve solo y quedaría "entregado" a nadie, invisible y sin poder
 * usarse otra vez.
 *
 * Uno que nació con este pago —propio, o conseguido en un cambio— no tiene a dónde volver: nunca
 * estuvo en cartera. Ese se borra, como se borra el que entró con un cobro que se elimina.
 */
export async function devolverChequesALaCartera(tx: Prisma.TransactionClient, paymentId: string) {
  await tx.cheque.deleteMany({ where: { entregadoEnId: paymentId, recibidoEnId: null } });
  await tx.cheque.updateMany({
    where: { entregadoEnId: paymentId },
    data: { estado: "EN_CARTERA", entregadoEnId: null },
  });
}

/** Cambia el estado de un cheque que está en cartera: depositado o rechazado. */
export async function marcarCheque(chequeId: string, estado: ChequeEstado) {
  const cheque = await prisma.cheque.findUnique({ where: { id: chequeId } });
  if (!cheque) throw new UserError("El cheque ya no existe.");
  if (cheque.entregadoEnId) {
    throw new UserError("Este cheque se entregó con un pago: borrá ese pago para devolverlo a la cartera.");
  }
  await prisma.cheque.update({ where: { id: chequeId }, data: { estado } });
}

/** El monto del cheque elegido, para validar contra el del pago. */
export function parseMontoCheque(raw: string) {
  return parseNumeroEscrito(raw, "monto del cheque");
}

/** La cartera serializada como la espera el formulario de pago. */
export async function getCarteraParaFormulario() {
  const cheques = await getCartera();
  return cheques.map((c) => ({
    id: c.id,
    numero: c.numero,
    banco: c.banco,
    esEcheq: c.esEcheq,
    amount: formatNumeroEditable(c.amount),
    montoLabel: formatMoney(c.amount),
    deQuien: c.recibidoEn?.account.entity.name ?? null,
    fechaCobro: c.fechaCobro ? formatFecha(c.fechaCobro) : null,
  }));
}
