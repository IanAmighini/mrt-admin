import "server-only";
import { Prisma, type FormaDeSueldo } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAccountBalances } from "@/lib/ledger";
import { sumDecimals, ZERO } from "@/lib/money";
import { esCaja } from "@/lib/pagos";
import { UserError } from "@/lib/user-error";
import { formatFecha } from "@/lib/period";
import { cuentaDelRenglon, type CuentaDelRenglon } from "@/lib/sueldos-calculo";

const DIA = 24 * 60 * 60 * 1000;
/** Las fechas se guardan a medianoche UTC (ver `parseFecha`), así que sumar días es sumar 24 h. */
export const sumarDias = (fecha: Date, dias: number) => new Date(fecha.getTime() + dias * DIA);

/** "Semana del 11/10 al 16/10", "Octubre 2026". */
export function nombreDePlanilla(p: { forma: FormaDeSueldo; desde: Date; hasta: Date }) {
  if (p.forma === "MENSUAL") {
    const mes = p.desde.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
    return `Sueldos de ${mes}`;
  }
  const corto = (d: Date) => formatFecha(d).split("/").slice(0, 2).join("/");
  return `Semana del ${corto(p.desde)} al ${corto(p.hasta)}`;
}

/** El número con que el gasto aparece en la cuenta del empleado: "SEM-11/10", "MES-10/2026". */
export function numeroDelGasto(p: { forma: FormaDeSueldo; desde: Date }) {
  const [dia, mes, anio] = formatFecha(p.desde).split("/");
  return p.forma === "MENSUAL" ? `MES-${mes}/${anio}` : `SEM-${dia}/${mes}`;
}

/** La tarifa que valía el primer día del período: la última que arrancó antes o ese día. */
export function tarifaVigente<T extends { desde: Date; monto: Prisma.Decimal }>(tarifas: T[], fecha: Date): T | null {
  return (
    [...tarifas]
      .filter((t) => t.desde.getTime() <= fecha.getTime())
      .sort((a, b) => b.desde.getTime() - a.desde.getTime())[0] ?? null
  );
}

/**
 * Los empleados, con lo que hace falta para liquidarlos: la tarifa, el saldo de sus dos cuentas y el
 * sueldo en Cuenta 1 que falta descontar.
 */
export async function getEmpleados(opciones?: { conBajas?: boolean }) {
  const empleados = await prisma.entity.findMany({
    where: { formaDeSueldo: { not: null }, ...(opciones?.conBajas ? {} : { empleadoBaja: null }) },
    include: {
      accounts: true,
      tarifasDeEmpleado: { orderBy: [{ desde: "desc" }, { createdAt: "desc" }], include: { createdBy: { select: { name: true } } } },
    },
    orderBy: { name: "asc" },
  });
  const ids = empleados.map((e) => e.id);
  const [saldos, pendientes] = await Promise.all([
    getAccountBalances(empleados.flatMap((e) => e.accounts.map((a) => a.id))),
    getPendientesCuenta1(ids),
  ]);
  return empleados
    .map((e) => ({
      ...e,
      forma: e.formaDeSueldo!,
      saldo: sumDecimals(e.accounts.map((a) => saldos.get(a.id) ?? ZERO)),
      pendienteCuenta1: pendientes.get(e.id) ?? ZERO,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export type Empleado = Awaited<ReturnType<typeof getEmpleados>>[number];

/**
 * El sueldo cargado en la Cuenta 1 de cada empleado (sus gastos ahí: el recibo de Alex) menos lo que
 * ya se descontó de semanas cerradas. Es lo que todavía tiene que restarse del sueldo en efectivo.
 */
export async function getPendientesCuenta1(entityIds: string[], hasta?: Date): Promise<Map<string, Prisma.Decimal>> {
  if (entityIds.length === 0) return new Map();
  const [gastos, descontados] = await Promise.all([
    prisma.document.groupBy({
      by: ["accountId"],
      where: {
        type: "GASTO",
        account: { entityId: { in: entityIds }, circuit: "BLANCO" },
        ...(hasta ? { date: { lte: hasta } } : {}),
      },
      _sum: { totalAmount: true },
    }),
    prisma.renglonDeSueldo.groupBy({
      by: ["entityId"],
      where: { entityId: { in: entityIds }, planilla: { estado: "CERRADA" } },
      _sum: { descuentoCuenta1: true },
    }),
  ]);
  const cuentas = await prisma.account.findMany({
    where: { id: { in: gastos.map((g) => g.accountId) } },
    select: { id: true, entityId: true },
  });
  const deCuenta = new Map(cuentas.map((c) => [c.id, c.entityId]));
  const pendientes = new Map<string, Prisma.Decimal>();
  for (const g of gastos) {
    const id = deCuenta.get(g.accountId)!;
    pendientes.set(id, (pendientes.get(id) ?? ZERO).plus(g._sum.totalAmount ?? ZERO));
  }
  for (const d of descontados) {
    pendientes.set(d.entityId, (pendientes.get(d.entityId) ?? ZERO).minus(d._sum.descuentoCuenta1 ?? ZERO));
  }
  for (const [id, v] of pendientes) if (v.isNegative()) pendientes.set(id, ZERO);
  return pendientes;
}

/** Las cajas de las que sale el efectivo de los sueldos: la chica primero, después Bufano. El banco no. */
export async function getCajasDeSueldos() {
  const cajas = await prisma.entity.findMany({ where: { type: "TESORERIA" }, select: { id: true, name: true, slug: true } });
  return cajas
    .filter((c) => esCaja(c.name))
    .sort((a, b) => Number(b.slug === "caja-chica") - Number(a.slug === "caja-chica") || a.name.localeCompare(b.name, "es"));
}

/**
 * Las fechas que propone la próxima planilla. La semana va hasta el viernes, que es cuando se paga:
 * la siguiente a la última cargada, o la que termina este viernes si no hay ninguna.
 */
export async function proximoPeriodo(forma: FormaDeSueldo, hoy: Date) {
  const ultima = await prisma.planillaDeSueldos.findFirst({ where: { forma }, orderBy: { hasta: "desc" } });
  if (forma === "MENSUAL") {
    const base = ultima ? sumarDias(ultima.hasta, 1) : new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    const desde = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
    const hasta = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
    return { desde, hasta, fechaDePago: hasta };
  }
  if (ultima) {
    const desde = sumarDias(ultima.hasta, 1);
    const hasta = sumarDias(desde, 6);
    return { desde, hasta, fechaDePago: hasta };
  }
  const hastaElViernes = (5 - hoy.getUTCDay() + 7) % 7;
  const hasta = sumarDias(hoy, hastaElViernes);
  return { desde: sumarDias(hasta, -6), hasta, fechaDePago: hasta };
}

/**
 * El gasto y el pago que genera una planilla al cerrarse no se corrigen desde la cuenta corriente
 * del empleado: la planilla diría una cosa y su cuenta otra. Se reabre la planilla.
 */
export async function exigirQueNoSeaDeSueldos(ref: { documentId?: string | null; paymentId?: string | null }) {
  if (!ref.documentId && !ref.paymentId) return;
  const renglon = await prisma.renglonDeSueldo.findFirst({
    where: {
      OR: [...(ref.documentId ? [{ gastoId: ref.documentId }] : []), ...(ref.paymentId ? [{ pagoId: ref.paymentId }] : [])],
    },
    include: { planilla: true },
  });
  if (renglon) {
    throw new UserError(
      `Esto lo cargó la planilla de Sueldos (${nombreDePlanilla(renglon.planilla).toLowerCase()}). Para corregirlo, reabrí la planilla desde Sueldos.`
    );
  }
}

/**
 * Los renglones de una planilla con su cuenta hecha. Cerrada, con los números con que se cerró (los
 * que están en las cuentas); en borrador, con lo de hoy: el saldo y la tarifa vigente de cada uno.
 */
export async function getRenglonesCalculados(planillaId: string) {
  const planilla = await prisma.planillaDeSueldos.findUnique({
    where: { id: planillaId },
    include: { renglones: { include: { entity: { select: { id: true, name: true, slug: true } } } } },
  });
  if (!planilla) return null;
  const empleados = planilla.estado === "BORRADOR" ? await getEmpleados({ conBajas: true }) : [];
  const porId = new Map(empleados.map((e) => [e.id, e]));
  const renglones = [...planilla.renglones]
    .sort((a, b) => a.entity.name.localeCompare(b.entity.name, "es"))
    .map((r) => {
      let tarifa: Prisma.Decimal | null;
      let cuenta: CuentaDelRenglon | null = null;
      if (planilla.estado === "CERRADA") {
        tarifa = r.tarifa;
        if (tarifa) {
          cuenta = cuentaDelRenglon({
            forma: planilla.forma,
            tarifa,
            horas: r.horas,
            horasFeriado: r.horasFeriado,
            saldoAnterior: r.saldoAnterior ?? ZERO,
            pendienteCuenta1: r.descuentoCuenta1 ?? ZERO,
            descuentoCuenta1: r.descuentoCuenta1,
            descuentoACuenta: r.descuentoACuenta,
            pagado: r.pagado,
          });
        }
      } else {
        const e = porId.get(r.entityId);
        tarifa = e ? (tarifaVigente(e.tarifasDeEmpleado, planilla.desde)?.monto ?? null) : null;
        if (e && tarifa) {
          cuenta = cuentaDelRenglon({
            forma: planilla.forma,
            tarifa,
            horas: r.horas,
            horasFeriado: r.horasFeriado,
            saldoAnterior: e.saldo,
            pendienteCuenta1: e.pendienteCuenta1,
            descuentoCuenta1: r.descuentoCuenta1,
            descuentoACuenta: r.descuentoACuenta,
            pagado: r.pagado,
          });
        }
      }
      return { r, tarifa, cuenta };
    });
  return { planilla, renglones };
}
