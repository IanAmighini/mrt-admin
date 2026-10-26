import "server-only";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/user-error";
import { logAudit } from "@/lib/audit";
import { reimputarEntidades } from "@/lib/imputacion";
import { asegurarSinNegativos } from "@/lib/sin-negativos";
import { circuitoDeTesoreria } from "@/lib/pagos";
import { formatMoney, sumDecimals, ZERO } from "@/lib/money";
import { formatFecha } from "@/lib/period";
import { cuentaDelRenglon } from "@/lib/sueldos-calculo";
import { getEmpleados, nombreDePlanilla, numeroDelGasto, tarifaVigente } from "@/lib/sueldos";

/**
 * Cierra la semana: a cada uno se le carga el gasto de lo que ganó y el pago de lo que se le dio
 * desde la caja, con los números que se ven en pantalla. Todo junto o nada: si la caja no alcanza,
 * no se graba ninguno.
 */
export async function cerrarPlanillaCore(planillaId: string, userId: string) {
  const planilla = await prisma.planillaDeSueldos.findUniqueOrThrow({
    where: { id: planillaId },
    include: { renglones: true },
  });
  if (!planilla.cajaId) throw new UserError("Elegí de qué caja sale el efectivo.");
  const caja = await prisma.entity.findUniqueOrThrow({ where: { id: planilla.cajaId }, include: { accounts: true } });
  const cuentaDeCaja = caja.accounts.find((a) => a.circuit === circuitoDeTesoreria(caja.name));
  if (!cuentaDeCaja) throw new UserError("No se encontró la cuenta de esa caja.");

  const empleados = new Map((await getEmpleados({ conBajas: true })).map((e) => [e.id, e]));
  const nombre = nombreDePlanilla(planilla);
  const numero = numeroDelGasto(planilla);

  const cuentas = planilla.renglones.map((r) => {
    const e = empleados.get(r.entityId);
    if (!e) throw new UserError("Uno de los empleados de la planilla ya no es empleado.");
    const tarifa = tarifaVigente(e.tarifasDeEmpleado, planilla.desde);
    if (!tarifa) throw new UserError(`${e.name} no tiene jornal cargado para el ${formatFecha(planilla.desde)}.`);
    const cuenta = cuentaDelRenglon({
      forma: planilla.forma,
      tarifa: tarifa.monto,
      horas: r.horas,
      horasFeriado: r.horasFeriado,
      presentismo: r.presentismo,
      puntualidad: r.puntualidad,
      monotributo: r.monotributo ?? ZERO,
      saldoAnterior: e.saldo,
      descuentoACuenta: r.descuentoACuenta,
      pagado: r.pagado,
    });
    return { r, e, tarifa: tarifa.monto, cuenta };
  });
  const conAlgo = cuentas.filter((c) => c.cuenta.gasto.greaterThan(0) || c.cuenta.pagado.greaterThan(0));
  if (conAlgo.length === 0) throw new UserError("La planilla está vacía: no hay horas ni nada para pagar.");
  const efectivo = sumDecimals(conAlgo.map((c) => c.cuenta.pagado));

  await prisma.$transaction(
    async (tx) => {
      for (const { r, e, tarifa, cuenta } of cuentas) {
        const negro = e.accounts.find((a) => a.circuit === "NEGRO")!;
        let gastoId: string | null = null;
        let pagoId: string | null = null;
        if (cuenta.gasto.greaterThan(0)) {
          const detalle = [
            planilla.forma === "SEMANAL" ? `${r.horas.toString().replace(".", ",")} h` : null,
            r.horasFeriado.greaterThan(0) ? `${r.horasFeriado.toString().replace(".", ",")} en feriado` : null,
            r.presentismo && planilla.forma === "SEMANAL" ? "presentismo" : null,
            r.puntualidad && planilla.forma === "SEMANAL" ? "puntualidad" : null,
            cuenta.monotributo.greaterThan(0) ? `monotributo ${formatMoney(cuenta.monotributo)}` : null,
            cuenta.redondeo.greaterThan(0) ? `redondeo ${formatMoney(cuenta.redondeo)}` : null,
          ].filter(Boolean);
          const gasto = await tx.document.create({
            data: {
              accountId: negro.id,
              type: "GASTO",
              number: numero,
              date: planilla.fechaDePago,
              dueDate: planilla.fechaDePago,
              currency: "ARS",
              expenseCategory: "SUELDOS",
              reason: [nombre, ...detalle].join(" · "),
              netAmount: cuenta.gasto,
              ivaAmount: ZERO,
              perceptionAmount: ZERO,
              retentionAmount: ZERO,
              totalAmount: cuenta.gasto,
              createdById: userId,
            },
          });
          gastoId = gasto.id;
        }
        if (cuenta.pagado.greaterThan(0)) {
          const pago = await tx.payment.create({
            data: {
              accountId: negro.id,
              date: planilla.fechaDePago,
              amount: cuenta.pagado,
              currency: "ARS",
              method: "EFECTIVO",
              reference: nombre,
              treasuryId: caja.id,
              createdById: userId,
            },
          });
          await tx.document.create({
            data: {
              accountId: cuentaDeCaja.id,
              type: "AJUSTE",
              number: `P-${pago.id.slice(-8)}`,
              date: planilla.fechaDePago,
              currency: "ARS",
              netAmount: cuenta.pagado,
              totalAmount: cuenta.pagado.negated(),
              reason: `Pago a ${e.name} — Efectivo — ${nombre}`,
              treasuryCategory: "PAGO_PROVEEDOR",
              sourcePaymentId: pago.id,
              createdById: userId,
            },
          });
          pagoId = pago.id;
        }
        await tx.renglonDeSueldo.update({
          where: { id: r.id },
          data: {
            tarifa,
            saldoAnterior: e.saldo,
            descuentoCuenta1: null,
            descuentoACuenta: cuenta.descuentoACuenta,
            pagado: cuenta.pagado,
            gastoId,
            pagoId,
          },
        });
      }

      // Que la caja tenga la plata ese día: si no, no se graba nada.
      await asegurarSinNegativos(tx, { cuentas: [cuentaDeCaja.id] });

      await tx.planillaDeSueldos.update({ where: { id: planilla.id }, data: { estado: "CERRADA", cerradaAt: new Date() } });
      await logAudit(tx, {
        userId,
        action: "UPDATE",
        entityType: "Planilla de sueldos",
        entityId: planilla.id,
        summary: `${nombre} cerrada — ${conAlgo.length} empleados — sueldos ${formatMoney(sumDecimals(cuentas.map((c) => c.cuenta.sueldo)))} — ${formatMoney(efectivo)} en efectivo de ${caja.name}`,
      });
    },
    { timeout: 30000 }
  );

  await reimputarEntidades(...cuentas.map((c) => c.e.id));
  return { cajaSlug: caja.slug };
}

/** Vuelve la planilla a borrador: borra los gastos y los pagos que cargó. Los números quedan. */
export async function reabrirPlanillaCore(planillaId: string, userId: string) {
  const planilla = await prisma.planillaDeSueldos.findUnique({ where: { id: planillaId }, include: { renglones: true } });
  if (!planilla) throw new UserError("Esa planilla ya no existe.");
  if (planilla.estado !== "CERRADA") throw new UserError("La planilla ya está abierta.");

  const gastos = planilla.renglones.flatMap((r) => (r.gastoId ? [r.gastoId] : []));
  const pagos = planilla.renglones.flatMap((r) => (r.pagoId ? [r.pagoId] : []));

  await prisma.$transaction(async (tx) => {
    await tx.renglonDeSueldo.updateMany({
      where: { planillaId },
      data: { gastoId: null, pagoId: null, saldoAnterior: null, tarifa: null },
    });
    await tx.paymentAllocation.deleteMany({ where: { OR: [{ paymentId: { in: pagos } }, { documentId: { in: gastos } }] } });
    await tx.document.deleteMany({ where: { sourcePaymentId: { in: pagos } } });
    await tx.payment.deleteMany({ where: { id: { in: pagos } } });
    await tx.document.deleteMany({ where: { id: { in: gastos } } });
    await tx.planillaDeSueldos.update({ where: { id: planillaId }, data: { estado: "BORRADOR", cerradaAt: null } });
    await logAudit(tx, {
      userId,
      action: "UPDATE",
      entityType: "Planilla de sueldos",
      entityId: planillaId,
      summary: `${nombreDePlanilla(planilla)} reabierta — se borraron ${gastos.length} gastos y ${pagos.length} pagos`,
    });
  });

  await reimputarEntidades(...planilla.renglones.map((r) => r.entityId));
}

