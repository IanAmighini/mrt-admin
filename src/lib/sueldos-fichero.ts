import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/user-error";
import { logAudit } from "@/lib/audit";
import { diffDeFotos, fotoDeLaPlanilla } from "@/lib/fotos";
import { emparejar, type ExportacionDelFichero } from "@/lib/fichero";
import { conCorrecciones, fechasDe, nombreDelMes, rangoDelMes, resumenDeSemana, type DiaFichero } from "@/lib/fichero-calculo";
import { fechaISO, getCorreccionesDelMes, getReglasFichero, nombreDePlanilla } from "@/lib/sueldos";

export type ResultadoDeImportacion = {
  importados: number;
  sinMarcas: string[];
  ambiguos: string[];
  pendientes: number;
  /** Si el archivo no cubre toda la semana: los días que faltan. */
  diasFuera: string[];
};

/**
 * Pasa las marcas del fichero a la planilla de la semana: a cada empleado le guarda los días y le
 * calcula las horas y el feriado con las reglas. Los bonos no: son por mes (`importarMesCore`). Todo queda editable: si se vuelve a
 * importar, las correcciones a mano de un día (de las cámaras) se conservan.
 *
 * El viernes anterior entra sólo por lo que se quedaron después del corte, que pasa a esta semana.
 */
export async function importarMarcasCore(
  planillaId: string,
  exportacion: ExportacionDelFichero,
  userId: string
): Promise<ResultadoDeImportacion> {
  const planilla = await prisma.planillaDeSueldos.findUnique({
    where: { id: planillaId },
    include: { renglones: { include: { entity: { select: { id: true, name: true, idFichero: true } } } } },
  });
  if (!planilla) throw new UserError("Esa planilla ya no existe.");
  if (planilla.forma !== "SEMANAL") throw new UserError("El fichero se importa en las planillas por semana.");
  if (planilla.estado !== "BORRADOR") throw new UserError("La planilla ya está cerrada: para cambiarla, reabrila.");

  const desde = fechaISO(planilla.desde);
  const hasta = fechaISO(planilla.hasta);
  const fechas = fechasDe(desde, hasta);
  const enElArchivo = (f: string) => f >= exportacion.desde && f <= exportacion.hasta;
  const diasFuera = fechas.filter((f) => !enElArchivo(f));
  if (diasFuera.length === fechas.length) {
    throw new UserError(
      `El archivo es del ${exportacion.desde.split("-").reverse().join("/")} al ${exportacion.hasta.split("-").reverse().join("/")} y no tiene ningún día de esta semana.`
    );
  }
  const viernesAnterior = new Date(Date.parse(`${desde}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const conArrastre = new Date(`${viernesAnterior}T00:00:00Z`).getUTCDay() === 5 && enElArchivo(viernesAnterior);

  const reglas = await getReglasFichero();
  const { pares, sinMarcas, ambiguos } = emparejar(
    planilla.renglones.map((r) => r.entity),
    exportacion.empleados,
    fechas
  );
  let pendientes = 0;

  await prisma.$transaction(
    async (tx) => {
      const antes = await fotoDeLaPlanilla(tx, planilla.id);
      for (const { empleado, delFichero, nuevo } of pares) {
        const renglon = planilla.renglones.find((r) => r.entityId === empleado.id)!;
        const anteriores = new Map(((renglon.dias as DiaFichero[] | null) ?? []).map((d) => [d.fecha, d]));
        // Las correcciones a mano de un día se conservan al volver a importar.
        const conservar = (d: DiaFichero): DiaFichero => {
          const a = anteriores.get(d.fecha);
          return { ...d, ...(a?.entrada !== undefined ? { entrada: a.entrada } : {}), ...(a?.salida !== undefined ? { salida: a.salida } : {}) };
        };
        const dias: DiaFichero[] = [
          ...(conArrastre ? [conservar({ fecha: viernesAnterior, marcas: delFichero.marcas[viernesAnterior] ?? [], arrastre: true })] : []),
          ...fechas.map((fecha) => conservar({ fecha, marcas: delFichero.marcas[fecha] ?? [] })),
        ];
        const r = resumenDeSemana(dias, reglas, { desde, hasta, feriados: planilla.feriados });
        pendientes += r.pendientes.length;
        await tx.renglonDeSueldo.update({
          where: { id: renglon.id },
          data: {
            dias: dias as unknown as Prisma.InputJsonValue,
            horas: new Prisma.Decimal(r.horas),
            horasFeriado: new Prisma.Decimal(r.horasFeriado),
          },
        });
        // La próxima vez se lo encuentra por el número, sin depender del nombre.
        if (nuevo && delFichero.id) await tx.entity.update({ where: { id: empleado.id }, data: { idFichero: delFichero.id } });
      }
      await logAudit(tx, {
        userId,
        action: "UPDATE",
        entityType: "Planilla de sueldos",
        entityId: planilla.id,
        summary: `${nombreDePlanilla(planilla)}: importadas las marcas del fichero de ${pares.length} empleados${pendientes ? ` (${pendientes} días con una marca de menos)` : ""}`,
        cambios: diffDeFotos(antes, await fotoDeLaPlanilla(tx, planilla.id)),
      });
    },
    { timeout: 30000 }
  );

  return {
    importados: pares.length,
    sinMarcas: sinMarcas.map((e) => e.name),
    ambiguos: ambiguos.map((e) => e.name),
    pendientes,
    diasFuera,
  };
}

const deFecha = (f: string) => f.split("-").reverse().join("/");

/**
 * El fichero del mes cuyos bonos paga la semana: a cada empleado le guarda los días del mes y le
 * marca presentismo y puntualidad según las reglas, con las correcciones de las cámaras que ya se le
 * hicieron en sus semanas. Las casillas quedan editables. Tiene que traer el mes entero: con un mes a
 * medias, el que no vino un día que no está en el archivo cobraría el presentismo.
 */
export async function importarMesCore(
  planillaId: string,
  exportacion: ExportacionDelFichero,
  userId: string
): Promise<{ importados: number; sinMarcas: string[]; ambiguos: string[]; pendientes: number }> {
  const planilla = await prisma.planillaDeSueldos.findUnique({
    where: { id: planillaId },
    include: { renglones: { include: { entity: { select: { id: true, name: true, idFichero: true } } } } },
  });
  if (!planilla) throw new UserError("Esa planilla ya no existe.");
  if (planilla.estado !== "BORRADOR") throw new UserError("La planilla ya está cerrada: para cambiarla, reabrila.");
  if (!planilla.bonosDe) throw new UserError("Primero elegí de qué mes son los bonos que se pagan esta semana.");

  const mes = planilla.bonosDe;
  const { desde, hasta } = rangoDelMes(mes);
  if (exportacion.desde > desde || exportacion.hasta < hasta) {
    throw new UserError(
      `Para los bonos de ${nombreDelMes(mes)} hace falta el fichero del mes entero (del ${deFecha(desde)} al ${deFecha(hasta)}), y este archivo es del ${deFecha(exportacion.desde)} al ${deFecha(exportacion.hasta)}.`
    );
  }
  // El reloj exporta el mes entero aunque se baje a mitad de mes: los días que faltaban pasar vienen
  // vacíos y contarían como faltas. El AllReport de octubre que se usó de muestra se bajó el 26/10.
  if (exportacion.creado && exportacion.creado <= hasta) {
    throw new UserError(
      `Este archivo se bajó el ${deFecha(exportacion.creado)}, antes de que terminara ${nombreDelMes(mes)}: los últimos días vienen vacíos y contarían como faltas. Bajalo de nuevo del reloj.`
    );
  }
  const fechas = fechasDe(desde, hasta);
  const reglas = await getReglasFichero();
  const { pares, sinMarcas, ambiguos } = emparejar(
    planilla.renglones.map((r) => r.entity),
    exportacion.empleados,
    fechas
  );
  const correcciones = await getCorreccionesDelMes(pares.map((p) => p.empleado.id), mes);
  let pendientes = 0;

  await prisma.$transaction(
    async (tx) => {
      const antes = await fotoDeLaPlanilla(tx, planilla.id);
      for (const { empleado, delFichero, nuevo } of pares) {
        const renglon = planilla.renglones.find((r) => r.entityId === empleado.id)!;
        const dias: DiaFichero[] = fechas.map((fecha) => ({ fecha, marcas: delFichero.marcas[fecha] ?? [] }));
        const r = resumenDeSemana(conCorrecciones(dias, correcciones.get(empleado.id) ?? []), reglas, {
          desde,
          hasta,
          feriados: planilla.feriadosDelMes,
        });
        pendientes += r.pendientes.length;
        await tx.renglonDeSueldo.update({
          where: { id: renglon.id },
          data: { diasDelMes: dias as unknown as Prisma.InputJsonValue, presentismo: r.presentismo, puntualidad: r.puntualidad },
        });
        if (nuevo && delFichero.id) await tx.entity.update({ where: { id: empleado.id }, data: { idFichero: delFichero.id } });
      }
      await logAudit(tx, {
        userId,
        action: "UPDATE",
        entityType: "Planilla de sueldos",
        entityId: planilla.id,
        summary: `${nombreDePlanilla(planilla)}: importado el fichero de ${nombreDelMes(mes)} para los bonos de ${pares.length} empleados${pendientes ? ` (${pendientes} días con una marca de menos)` : ""}`,
        cambios: diffDeFotos(antes, await fotoDeLaPlanilla(tx, planilla.id)),
      });
    },
    { timeout: 30000 }
  );
  return { importados: pares.length, sinMarcas: sinMarcas.map((e) => e.name), ambiguos: ambiguos.map((e) => e.name), pendientes };
}
