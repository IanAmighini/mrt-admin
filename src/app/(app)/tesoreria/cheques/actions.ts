"use server";

import { revalidatePath } from "next/cache";
import { reimputarEntidades } from "@/lib/imputacion";
import { formatFecha, parseFecha } from "@/lib/period";
import { Prisma, type ChequeEstado } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { UserError } from "@/lib/user-error";
import { diffDeCampos, logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { marcarCheque } from "@/lib/cheques";
import { circuitoDeTesoreria } from "@/lib/pagos";
import { CHEQUE_ESTADO_LABELS, CIRCUIT_LABELS } from "@/lib/labels";
import { formatMoney, formatNumeroEditable, parseNumeroEscrito, parseNumeroOpcional, sumDecimals, ZERO } from "@/lib/money";
import { rendimientoDeFinanciera } from "@/lib/financiera";

function parseFormDate(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return parseFecha(str);
}

const ESTADOS_MANUALES: ChequeEstado[] = ["DEPOSITADO", "EN_CARTERA"];

/** Depositar un cheque, o devolverlo a cartera. El rechazo va aparte: mueve cuentas corrientes. */
export async function actualizarEstadoCheque(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const chequeId = String(formData.get("chequeId") || "");
  const estado = String(formData.get("estado") || "") as ChequeEstado;
  if (!ESTADOS_MANUALES.includes(estado)) throw new UserError("Estado inválido.");

  // El estado anterior se lee antes de pisarlo: es lo único que cambia acá, y sin eso el detalle
  // de Actividad no dice de dónde venía.
  const antes = await prisma.cheque.findUnique({ where: { id: chequeId }, select: { estado: true } });

  await marcarCheque(chequeId, estado);

  const cheque = await prisma.cheque.findUnique({ where: { id: chequeId } });
  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Cheque",
    entityId: chequeId,
    summary: `#${cheque?.numero ?? chequeId} — ${CHEQUE_ESTADO_LABELS[estado]}`,
    cambios: [
      {
        campo: "Estado",
        antes: antes ? CHEQUE_ESTADO_LABELS[antes.estado] : null,
        despues: CHEQUE_ESTADO_LABELS[estado],
      },
    ],
  });

  revalidatePath("/tesoreria/cheques");
}

/**
 * Cambio de cheques por efectivo: le damos plata a otra empresa y nos da cheques. Es a la par, así
 * que el efectivo que sale de la caja es el total de los cheques que entran.
 *
 * **No mueve el saldo de la caja**: sale efectivo y entran cheques por lo mismo, y los cheques
 * cuentan en la caja donde están, igual que los que entran con un cobro. Cuando se paga con ellos,
 * salen de esa caja. Antes restaba el efectivo y los cheques no sumaban, así que al pagar con ellos
 * la plata salía dos veces: en octubre Pedro tuvo que compensarlo a mano, y el pago a Rainap del
 * 23/10 terminó cargado al Galicia porque a Bufano ya no le alcanzaba.
 *
 * Queda un movimiento en cero en la caja —para que se vea en su libro y para deshacer todo junto—
 * con los cheques colgados de él.
 */
export async function cambiarChequesPorEfectivo(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const treasuryId = String(formData.get("treasuryId") || "");
  const tesoreria = await prisma.entity.findUnique({ where: { id: treasuryId } });
  if (!tesoreria || tesoreria.type !== "TESORERIA") {
    throw new UserError("Elegí de qué caja sale el efectivo.");
  }
  // Cada caja tiene una sola cuenta: el efectivo sale de ahí, sin elegir circuito.
  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId: treasuryId, circuit: circuitoDeTesoreria(tesoreria.name) } },
    include: { entity: true },
  });
  if (!account) throw new UserError("Elegí de qué caja sale el efectivo.");

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
      fechaCobro: c.fechaRaw ? parseFecha(c.fechaRaw) : null,
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
        // En cero: sale el efectivo y entran los cheques por lo mismo. `netAmount` guarda cuánto fue.
        netAmount: total,
        totalAmount: ZERO,
        reason: `Cambio de ${data.length} cheque(s) por ${formatMoney(total)} en efectivo${cambiadoA ? ` — ${cambiadoA}` : ""}`,
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
      cambios: diffDeCampos(
        null,
        {
          date,
          caja: account.entity.name,
          cambiadoA,
          total: formatMoney(total),
          // Un renglón por cheque: es lo que se controla contra los papeles.
          cheques: data
            .map((c) => `#${c.numero}${c.banco ? ` (${c.banco})` : ""} — ${formatMoney(c.amount)}`)
            .join("\n"),
        },
        {
          date: "Fecha",
          caja: "Sale de",
          cambiadoA: "Cambiado a",
          total: "Total",
          cheques: "Cheques",
        }
      ),
    });
  });

  revalidatePath("/tesoreria/cheques");
  revalidatePath("/tesoreria");
}

/** Los cheques que da una financiera son de papel y quedan siempre en Caja Bufano. */
const CAJA_DE_LA_FINANCIERA = "Caja Bufano";

/**
 * Cheques de una financiera: un cliente le transfiere a la financiera lo que nos debe, y ella nos
 * da cheques a plazo por más. Son tres cosas a la vez, y se cargan juntas:
 *  - **El cobro del cliente, por lo que transfirió.** Es lo que pagó; lo que los cheques valen de
 *    más no es suyo.
 *  - **Los cheques, en cartera en Caja Bufano**, por lo que dice el papel.
 *  - **La diferencia, como ingreso financiero**: suma al resultado del mes. Antes se cargaba como
 *    aporte de Cristian para que el efectivo cerrara, y la ganancia no aparecía en ningún lado.
 *
 * En la caja entran el cobro y la ganancia, que juntos son lo que valen los cheques. Los cheques
 * cuelgan del movimiento de la ganancia, y éste del cobro: borrando el movimiento se va todo.
 */
export async function registrarChequesDeFinanciera(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const caja = await prisma.entity.findFirst({ where: { type: "TESORERIA", name: CAJA_DE_LA_FINANCIERA } });
  const cajaAccount = caja
    ? await prisma.account.findUnique({
        where: { entityId_circuit: { entityId: caja.id, circuit: circuitoDeTesoreria(caja.name) } },
      })
    : null;
  if (!caja || !cajaAccount) throw new UserError(`No se encontró ${CAJA_DE_LA_FINANCIERA}.`);

  const financiera = String(formData.get("financiera") || "").trim();
  if (!financiera) throw new UserError("Escribí el nombre de la financiera.");
  const date = parseFormDate(formData.get("date"));

  const entityId = String(formData.get("entityId") || "");
  const circuit = String(formData.get("circuit") || "");
  if (circuit !== "BLANCO" && circuit !== "NEGRO") throw new UserError("Elegí la cuenta del cliente.");
  const cuenta = entityId
    ? await prisma.account.findUnique({
        where: { entityId_circuit: { entityId, circuit } },
        include: { entity: true },
      })
    : null;
  if (!cuenta || !["CLIENTE", "AMBOS"].includes(cuenta.entity.type)) throw new UserError("Elegí qué cliente transfirió.");
  // Los cheques son en pesos: un cliente en dólares pediría una cotización que este formulario no tiene.
  if (cuenta.entity.moneda !== "ARS") {
    throw new UserError(`La cuenta de ${cuenta.entity.name} va en dólares: cargá el cobro desde su ficha.`);
  }

  const transferencia = parseNumeroEscrito(String(formData.get("transferencia") || ""), "lo que transfirió el cliente");
  if (!transferencia.greaterThan(0)) throw new UserError("Lo que transfirió el cliente tiene que ser mayor a cero.");

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
    .filter((c) => c.numero || c.montoRaw)
    .map((c) => {
      if (!c.numero) throw new UserError("Falta el número de uno de los cheques.");
      return {
        numero: c.numero,
        banco: c.banco,
        amount: parseNumeroEscrito(c.montoRaw, `monto del cheque ${c.numero}`),
        fechaCobro: c.fechaRaw ? parseFecha(c.fechaRaw) : null,
      };
    });
  if (cheques.length === 0) throw new UserError("Cargá al menos un cheque.");

  const { total, ganancia, pct, dias } = rendimientoDeFinanciera({
    fecha: date,
    transferencia,
    cheques: cheques.map((c) => ({ monto: c.amount, fechaCobro: c.fechaCobro })),
  });
  if (ganancia.isNegative()) {
    throw new UserError(
      `Los cheques suman ${formatMoney(total)}, menos que lo que transfirió el cliente (${formatMoney(transferencia)}). Revisá los montos.`
    );
  }
  const rinde = pct ? ` · ${formatNumeroEditable(pct)}% a ${dias} ${dias === 1 ? "día" : "días"}` : "";

  await prisma.$transaction(async (tx) => {
    const cobro = await tx.payment.create({
      data: {
        accountId: cuenta.id,
        date,
        amount: transferencia,
        currency: "ARS",
        method: "TRANSFERENCIA",
        reference: `Transferencia a ${financiera}`,
        treasuryId: caja.id,
        createdById: user.id,
      },
    });
    // El cobro entra a la caja como cualquier otro: es lo que trae, y se va con él.
    await tx.document.create({
      data: {
        accountId: cajaAccount.id,
        type: "AJUSTE",
        number: `P-${cobro.id.slice(-8)}`,
        date,
        currency: "ARS",
        netAmount: transferencia,
        totalAmount: transferencia,
        reason: `Cobro de ${cuenta.entity.name} — Transferencia a ${financiera}`,
        treasuryCategory: "COBRO",
        sourcePaymentId: cobro.id,
        createdById: user.id,
      },
    });
    const movimiento = await tx.document.create({
      data: {
        accountId: cajaAccount.id,
        type: "AJUSTE",
        number: `FIN-${Date.now().toString(36).toUpperCase()}`,
        date,
        currency: "ARS",
        netAmount: ganancia,
        totalAmount: ganancia,
        reason: `Cheques de ${financiera} por ${formatMoney(total)}, por la transferencia de ${cuenta.entity.name}${rinde}`,
        treasuryCategory: "INGRESO_FINANCIERO",
        cobroDeFinancieraId: cobro.id,
        createdById: user.id,
      },
    });
    await tx.cheque.createMany({
      data: cheques.map((c) => ({
        ...c,
        estado: "EN_CARTERA" as const,
        cambiadoA: financiera,
        cambioEnId: movimiento.id,
        createdById: user.id,
      })),
    });

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Cheques de financiera",
      entityId: movimiento.id,
      summary: `${financiera} — ${cheques.length} cheque(s) por ${formatMoney(total)}, transferencia de ${cuenta.entity.name} por ${formatMoney(transferencia)}`,
      cambios: diffDeCampos(
        null,
        {
          date,
          financiera,
          cliente: `${cuenta.entity.name} · ${CIRCUIT_LABELS[cuenta.circuit]}`,
          transferencia: formatMoney(transferencia),
          total: formatMoney(total),
          ganancia: `${formatMoney(ganancia)}${rinde}`,
          cheques: cheques
            .map((c) => `#${c.numero}${c.banco ? ` (${c.banco})` : ""} — ${formatMoney(c.amount)}${c.fechaCobro ? ` — ${formatFecha(c.fechaCobro)}` : ""}`)
            .join("\n"),
        },
        {
          date: "Fecha",
          financiera: "Financiera",
          cliente: "Transfirió",
          transferencia: "Transferencia",
          total: "Cheques",
          ganancia: "Ingreso financiero",
          cheques: "Detalle",
        }
      ),
    });
  });

  await reimputarEntidades(cuenta.entityId);
  revalidatePath("/tesoreria/cheques");
  revalidatePath("/tesoreria");
  revalidatePath(`/cuentas-corrientes/${cuenta.entity.slug}`);
  revalidatePath(`/cuentas-corrientes/${caja.slug}`);
  revalidatePath("/pagos-clientes");
}

/**
 * Un cheque que vuelve rechazado.
 *
 * El cheque no valía, así que todo lo que se canceló con él vuelve a deberse. Se resuelve con notas
 * de débito y no borrando los pagos: el pago existió —se entregó el papel— y borrarlo dejaría la
 * cuenta cerrando bien pero sin explicar por qué.
 *
 * Toca hasta dos cuentas:
 *  - La del proveedor al que se le entregó: vuelve la deuda, más lo que cobra por el rechazo (un
 *    fijo y un porcentaje sobre el valor, que se cargan como dos renglones aparte, igual que los
 *    manda él).
 *  - La del cliente que lo dio: vuelve su deuda, porque su pago no valió.
 */
export async function rechazarCheque(formData: FormData) {
  // También la secretaría: es a ella a quien le avisan que un cheque volvió.
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const chequeId = String(formData.get("chequeId") || "");
  const cheque = await prisma.cheque.findUnique({
    where: { id: chequeId },
    include: {
      recibidoEn: { include: { account: { include: { entity: true } } } },
      entregadoEn: { include: { account: { include: { entity: true } } } },
    },
  });
  if (!cheque) throw new UserError("El cheque ya no existe.");
  if (cheque.estado === "RECHAZADO") throw new UserError("Este cheque ya está marcado como rechazado.");

  const date = parseFormDate(formData.get("date"));
  const gastoFijo = parseNumeroOpcional(String(formData.get("gastoFijo") || ""), "gasto fijo");
  const gastoPorcentaje = parseNumeroOpcional(String(formData.get("gastoPorcentaje") || ""), "porcentaje");
  const gastoVariable = cheque.amount.times(gastoPorcentaje).dividedBy(100);

  const notas: { accountId: string; total: Prisma.Decimal; motivo: string }[] = [];

  if (cheque.entregadoEn) {
    const cuenta = cheque.entregadoEn.accountId;
    notas.push({
      accountId: cuenta,
      total: cheque.amount,
      motivo: `Cheque ${cheque.numero} rechazado — se anula el pago`,
    });
    if (gastoFijo.greaterThan(0)) {
      notas.push({ accountId: cuenta, total: gastoFijo, motivo: `Gastos por cheque ${cheque.numero} rechazado` });
    }
    if (gastoVariable.greaterThan(0)) {
      notas.push({
        accountId: cuenta,
        total: gastoVariable,
        motivo: `Gtos cheq rechazado ${gastoPorcentaje.toFixed(0)}% s/valor (${cheque.numero})`,
      });
    }
  }

  if (cheque.recibidoEn) {
    notas.push({
      accountId: cheque.recibidoEn.accountId,
      total: cheque.amount,
      motivo: `Cheque ${cheque.numero} rechazado — se anula el cobro`,
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const [i, nota] of notas.entries()) {
      await tx.document.create({
        data: {
          accountId: nota.accountId,
          type: "NOTA_DEBITO",
          number: `ND-CHQ-${cheque.numero}${notas.length > 1 ? `-${i + 1}` : ""}`,
          date,
          currency: "ARS",
          netAmount: nota.total,
          totalAmount: nota.total,
          reason: nota.motivo,
          createdById: user.id,
        },
      });
    }

    await tx.cheque.update({ where: { id: chequeId }, data: { estado: "RECHAZADO" } });

    await logAudit(tx, {
      userId: user.id,
      action: "UPDATE",
      entityType: "Cheque",
      entityId: chequeId,
      summary: `#${cheque.numero} rechazado — ${notas.length} nota(s) de débito por ${formatMoney(sumDecimals(notas.map((n) => n.total)))}`,
      cambios: [
        { campo: "Estado", antes: CHEQUE_ESTADO_LABELS[cheque.estado], despues: CHEQUE_ESTADO_LABELS.RECHAZADO },
        { campo: "Fecha del rechazo", antes: null, despues: formatFecha(date) },
        {
          campo: "Notas de d\u00e9bito",
          antes: null,
          despues: notas.map((n) => `${n.motivo} — ${formatMoney(n.total)}`).join("\n"),
        },
      ],
    });
  });

  await reimputarEntidades(cheque.entregadoEn?.account.entityId, cheque.recibidoEn?.account.entityId);
  for (const slug of [
    cheque.entregadoEn?.account.entity.slug,
    cheque.recibidoEn?.account.entity.slug,
  ]) {
    if (slug) revalidatePath(`/cuentas-corrientes/${slug}`);
  }
  revalidatePath("/tesoreria/cheques");
}
