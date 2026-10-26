import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/user-error";
import { logAudit } from "@/lib/audit";
import { emparejar, type ExportacionDelFichero } from "@/lib/fichero";
import { fechasDe, resumenDeSemana, type DiaFichero } from "@/lib/fichero-calculo";
import { fechaISO, getReglasFichero, nombreDePlanilla } from "@/lib/sueldos";

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
 * calcula las horas, el feriado y los dos bonos con las reglas. Todo queda editable: si se vuelve a
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
            presentismo: r.presentismo,
            puntualidad: r.puntualidad,
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
