import "server-only";
import { Prisma, type FormaDeSueldo } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAccountBalances } from "@/lib/ledger";
import { ZERO } from "@/lib/money";
import { esCaja } from "@/lib/pagos";
import { UserError } from "@/lib/user-error";
import { formatFecha } from "@/lib/period";
import { cuentaDelRenglon, type CuentaDelRenglon } from "@/lib/sueldos-calculo";
import { getSetting } from "@/lib/settings";
import { leerReglas, rangoDelMes, type DiaFichero } from "@/lib/fichero-calculo";

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
 * Los empleados, con lo que hace falta para liquidarlos: la tarifa y el saldo de su Cuenta 2, que es
 * donde va el sueldo. La Cuenta 1 queda afuera: ahí va el bono de Alex, que se carga y se paga aparte
 * (hasta el 26/10 se descontaba de la semana).
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
  const negras = empleados.flatMap((e) => e.accounts.filter((a) => a.circuit === "NEGRO"));
  const saldos = await getAccountBalances(negras.map((a) => a.id));
  return empleados
    .map((e) => {
      const negra = e.accounts.find((a) => a.circuit === "NEGRO");
      return { ...e, forma: e.formaDeSueldo!, saldo: negra ? (saldos.get(negra.id) ?? ZERO) : ZERO };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export type Empleado = Awaited<ReturnType<typeof getEmpleados>>[number];

/** El monotributo del último mes cerrado de cada uno: el del mes nuevo arranca con ése. */
export async function getUltimosMonotributos(entityIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  const renglones = await prisma.renglonDeSueldo.findMany({
    where: { entityId: { in: entityIds }, monotributo: { not: null }, planilla: { forma: "MENSUAL", estado: "CERRADA" } },
    orderBy: { planilla: { desde: "desc" } },
    select: { entityId: true, monotributo: true },
  });
  const ultimos = new Map<string, Prisma.Decimal>();
  for (const r of renglones) if (!ultimos.has(r.entityId)) ultimos.set(r.entityId, r.monotributo!);
  return ultimos;
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
            ...bonosDelRenglon(planilla, r),
            monotributo: r.monotributo ?? ZERO,
            saldoAnterior: r.saldoAnterior ?? ZERO,
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
            ...bonosDelRenglon(planilla, r),
            monotributo: r.monotributo ?? ZERO,
            saldoAnterior: e.saldo,
            descuentoACuenta: r.descuentoACuenta,
            pagado: r.pagado,
          });
        }
      }
      return { r, tarifa, cuenta };
    });
  return { planilla, renglones };
}

export const SETTING_REGLAS_FICHERO = "reglasFichero";
/** Las reglas con que se calculan las horas del fichero (Sueldos → Reglas del fichero). */
export async function getReglasFichero() {
  return leerReglas(await getSetting(SETTING_REGLAS_FICHERO, ""));
}

/** Las fechas de una planilla como las usa el fichero: "2026-10-17". */
export const fechaISO = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Los bonos que cuentan en un renglón: sólo si la planilla paga los de algún mes. Una semana sin mes
 * elegido no lleva bonos aunque el renglón tenga marcada una casilla de antes.
 */
export function bonosDelRenglon(
  planilla: { bonosDe: string | null },
  r: { presentismo: boolean; puntualidad: boolean }
) {
  const conBonos = Boolean(planilla.bonosDe);
  return { presentismo: conBonos && r.presentismo, puntualidad: conBonos && r.puntualidad };
}

/**
 * Lo que se corrigió a mano en las semanas de un mes (la entrada o la salida de un día, de las
 * cámaras), por empleado: el mes de los bonos los toma arreglados.
 */
export async function getCorreccionesDelMes(entityIds: string[], mes: string): Promise<Map<string, DiaFichero[]>> {
  const { desde, hasta } = rangoDelMes(mes);
  const renglones = await prisma.renglonDeSueldo.findMany({
    where: {
      entityId: { in: entityIds },
      dias: { not: Prisma.DbNull },
      planilla: { forma: "SEMANAL", desde: { lte: new Date(`${hasta}T00:00:00Z`) }, hasta: { gte: new Date(`${desde}T00:00:00Z`) } },
    },
    select: { entityId: true, dias: true },
  });
  const porEmpleado = new Map<string, DiaFichero[]>();
  for (const r of renglones) {
    const editados = ((r.dias as DiaFichero[] | null) ?? []).filter(
      (d) => !d.arrastre && d.fecha >= desde && d.fecha <= hasta && (d.entrada !== undefined || d.salida !== undefined)
    );
    porEmpleado.set(r.entityId, [...(porEmpleado.get(r.entityId) ?? []), ...editados]);
  }
  return porEmpleado;
}

/** "2026-09" del mes en que cae una fecha. */
export const mesDe = (d: Date) => d.toISOString().slice(0, 7);
