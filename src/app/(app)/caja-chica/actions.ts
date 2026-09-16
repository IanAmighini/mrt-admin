"use server";

import { revalidatePath } from "next/cache";
import type { ExpenseCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { UserError } from "@/lib/user-error";
import { logAudit } from "@/lib/audit";
import { formatMoney, parseNumeroEscrito } from "@/lib/money";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { getCajaChica, proximoNumeroDeCaja, type CajaConCuenta } from "@/lib/caja";

/** Todas las pantallas de caja escriben en la caja chica; la grande se maneja desde su ficha. */
async function cajaYUsuario() {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);
  const caja = await getCajaChica();
  return { user, caja };
}

function leerFecha(raw: FormDataEntryValue | null) {
  const valor = String(raw || "").trim();
  if (!valor) throw new UserError("Falta la fecha.");
  // Igual que el resto de la app: la fecha del calendario se guarda como medianoche local, sin
  // convertir a UTC, para que no se corra un día.
  return new Date(`${valor}T00:00:00`);
}

function leerRubro(raw: FormDataEntryValue | null): ExpenseCategory | null {
  const valor = String(raw || "").trim();
  if (!valor) return null;
  if (!(valor in EXPENSE_CATEGORY_LABELS)) throw new UserError("Rubro inválido.");
  return valor as ExpenseCategory;
}

function revalidarCajas(cajas: CajaConCuenta[]) {
  revalidatePath("/caja-chica");
  revalidatePath("/tesoreria");
  for (const caja of cajas) revalidatePath(`/cuentas-corrientes/${caja.slug}`);
}

/**
 * Lo que sale de la caja y no cancela ninguna cuenta corriente: sueldos, la limpieza, el remís, el
 * monotributo. Baja el saldo de la caja y —por llevar rubro— cuenta como gasto del mes, que es lo
 * que antes no pasaba: esa plata salía sin dejar rastro en ningún lado.
 *
 * Lo que sí es de un proveedor con cuenta se carga como pago con Origen = Caja chica, no acá: así
 * además de bajar la caja le baja la deuda.
 */
export async function crearGastoDeCaja(formData: FormData) {
  const { user, caja } = await cajaYUsuario();

  const date = leerFecha(formData.get("date"));
  const amount = parseNumeroEscrito(String(formData.get("amount") || ""), "monto");
  if (!amount.greaterThan(0)) throw new UserError("El monto tiene que ser mayor a cero.");
  const concepto = String(formData.get("concepto") || "").trim();
  if (!concepto) throw new UserError("Escribí de qué es el gasto.");
  const expenseCategory = leerRubro(formData.get("expenseCategory"));

  const numero = await prisma.$transaction(async (tx) => {
    const number = await proximoNumeroDeCaja(tx, caja.accountId);
    await tx.document.create({
      data: {
        accountId: caja.accountId,
        type: "AJUSTE",
        number,
        date,
        currency: "ARS",
        // El neto queda en positivo y el total con signo: el saldo de la caja se arma sumando
        // totales, y los reportes de gastos suman netos.
        netAmount: amount,
        totalAmount: amount.negated(),
        reason: concepto,
        treasuryCategory: "GASTO",
        expenseCategory,
        createdById: user.id,
      },
    });
    return number;
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Movimiento de caja",
    summary: `Gasto de caja ${numero} — ${concepto} — ${formatMoney(amount)}`,
  });

  revalidarCajas([caja]);
}

/**
 * La plata que se mueve de una caja a otra: lo que la caja grande le da a la secretaría para la
 * semana, y lo que ella devuelve.
 *
 * Son dos movimientos, uno en cada libro, porque cada caja lleva su propio saldo — pero es un solo
 * hecho, así que se escriben juntos y quedan atados: borrar uno borra el otro. Cargados por
 * separado, nada garantizaba que coincidieran.
 */
export async function crearPaseDeCaja(formData: FormData) {
  const { user, caja } = await cajaYUsuario();

  const date = leerFecha(formData.get("date"));
  const amount = parseNumeroEscrito(String(formData.get("amount") || ""), "monto");
  if (!amount.greaterThan(0)) throw new UserError("El monto tiene que ser mayor a cero.");

  const entra = String(formData.get("sentido") || "ENTRA") === "ENTRA";
  const otraCajaId = String(formData.get("otraCajaId") || "");
  if (!otraCajaId) throw new UserError("Elegí con qué caja es el pase.");
  if (otraCajaId === caja.id) throw new UserError("Un pase va entre dos cajas distintas.");

  const otra = await prisma.entity.findUnique({
    where: { id: otraCajaId },
    include: { accounts: { where: { circuit: "NEGRO" } } },
  });
  const otraAccount = otra?.accounts[0];
  if (!otra || otra.type !== "TESORERIA" || !otraAccount) {
    throw new UserError("No se encontró la otra caja.");
  }

  const detalle = String(formData.get("concepto") || "").trim();
  const texto = (desde: string, hacia: string) =>
    [`Pase de ${desde} a ${hacia}`, detalle].filter(Boolean).join(" · ");
  const razon = entra ? texto(otra.name, caja.name) : texto(caja.name, otra.name);

  const pata = (accountId: string, number: string, signo: 1 | -1, contraparteId?: string) => ({
    accountId,
    type: "AJUSTE" as const,
    number,
    date,
    currency: "ARS" as const,
    netAmount: amount,
    totalAmount: signo === 1 ? amount : amount.negated(),
    reason: razon,
    treasuryCategory: "PASE" as const,
    createdById: user.id,
    ...(contraparteId ? { contraparteId } : {}),
  });

  await prisma.$transaction(async (tx) => {
    const numeroAca = await proximoNumeroDeCaja(tx, caja.accountId);
    const numeroAlla = await proximoNumeroDeCaja(tx, otraAccount.id);
    const aca = await tx.document.create({ data: pata(caja.accountId, numeroAca, entra ? 1 : -1) });
    await tx.document.create({
      data: pata(otraAccount.id, numeroAlla, entra ? -1 : 1, aca.id),
    });
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Movimiento de caja",
    summary: `${razon} — ${formatMoney(amount)}`,
  });

  revalidarCajas([caja, { ...otra, accountId: otraAccount.id }]);
}

/** Borra un movimiento de la caja chica. Si es un pase, se lleva también la pata de la otra caja. */
export async function borrarMovimientoDeCaja(formData: FormData) {
  const { user, caja } = await cajaYUsuario();

  const documentId = String(formData.get("documentId") || "");
  const documento = await prisma.document.findUnique({
    where: { id: documentId },
    include: { contraparte: { include: { account: { include: { entity: true } } } }, contraparteDe: true },
  });
  if (!documento) throw new UserError("El movimiento ya no existe.");
  if (documento.accountId !== caja.accountId) {
    throw new UserError("Ese movimiento no es de la caja chica.");
  }
  // Un cobro o un pago escribe su movimiento de caja solo: se borra borrando el pago, o el saldo
  // de la cuenta corriente y el de la caja dejan de coincidir.
  if (documento.sourcePaymentId) {
    throw new UserError("Este movimiento lo generó un pago: borrá el pago y se va solo.");
  }

  const otraPata = documento.contraparteId ?? documento.contraparteDe?.id ?? null;

  await prisma.$transaction(async (tx) => {
    if (otraPata) await tx.document.deleteMany({ where: { id: otraPata } });
    await tx.document.deleteMany({ where: { id: documentId } });
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Movimiento de caja",
    summary: `${documento.number} — ${documento.reason ?? ""} — ${formatMoney(documento.totalAmount)}`,
  });

  const otraCaja = documento.contraparte?.account.entity;
  revalidarCajas([caja, ...(otraCaja ? [{ ...otraCaja, accountId: "" }] : [])]);
}
