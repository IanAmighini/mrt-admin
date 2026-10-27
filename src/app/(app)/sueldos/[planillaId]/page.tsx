import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatMoney, formatNumeroExacto, sumDecimals, ZERO } from "@/lib/money";
import { formatFecha, toDateInputValue } from "@/lib/period";
import { cuentaDelRenglon } from "@/lib/sueldos-calculo";
import { bonosDelRenglon, fechaISO, getCajasDeSueldos, getCorreccionesDelMes, getEmpleados, getReglasFichero, mesDe, nombreDePlanilla, tarifaVigente } from "@/lib/sueldos";
import { conCorrecciones, mesAnterior, nombreDelMes, rangoDelMes, type DiaFichero } from "@/lib/fichero-calculo";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { PlanillaDeSueldosGrid } from "@/components/PlanillaDeSueldosGrid";
import { buttonClass } from "@/components/ui/Button";
import { borrarPlanilla, elegirBonosDe, guardarPlanilla, importarFichero, importarFicheroDelMes, reabrirPlanilla } from "../actions";
import { FormConError } from "@/components/FormConError";
import { controlClass } from "@/components/ui/Field";

const celda = "px-2 py-1.5";

export default async function PlanillaPage({
  params,
  searchParams,
}: {
  params: Promise<{ planillaId: string }>;
  searchParams: Promise<{ importados?: string; bonos?: string; pendientes?: string; sinMarcas?: string; ambiguos?: string; diasFuera?: string }>;
}) {
  const { planillaId } = await params;
  const importacion = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const planilla = await prisma.planillaDeSueldos.findUnique({
    where: { id: planillaId },
    include: {
      renglones: { include: { entity: { select: { id: true, name: true, slug: true } } } },
      createdBy: { select: { name: true } },
    },
  });
  if (!planilla) notFound();
  const [cajas, empleados] = await Promise.all([getCajasDeSueldos(), getEmpleados({ conBajas: true })]);
  const porId = new Map(empleados.map((e) => [e.id, e]));
  const renglones = [...planilla.renglones].sort((a, b) => a.entity.name.localeCompare(b.entity.name, "es"));
  const caja = cajas.find((c) => c.id === planilla.cajaId);
  const semanal = planilla.forma === "SEMANAL";

  const encabezado = (
    <div className="space-y-1">
      <Link href="/sueldos" className="inline-flex items-center gap-1 text-sm text-foreground/50 hover:text-foreground">
        <ArrowLeft size={14} /> Sueldos
      </Link>
      <h1 className="text-xl font-semibold">{nombreDePlanilla(planilla)}</h1>
      <p className="text-sm text-foreground/60">
        {planilla.estado === "CERRADA"
          ? `Pagada el ${formatFecha(planilla.fechaDePago)} desde ${caja?.name ?? "la caja"}.`
          : "Borrador: todavía no movió plata. Cargá las horas, guardá cuando quieras y cerrala el día de pago."}
      </p>
    </div>
  );

  const bajarExcel = (
    <a href={`/sueldos/${planilla.id}/excel`} className={buttonClass("secundario", "inline-flex items-center gap-1.5")}>
      <Download size={16} /> Excel
    </a>
  );

  const mesDeBonos = planilla.bonosDe;
  const nombreBonos = mesDeBonos ? nombreDelMes(mesDeBonos, planilla.fechaDePago.toISOString()) : null;

  if (planilla.estado === "BORRADOR") {
    // Los días del mes de los bonos, con lo que ya se corrigió a mano en sus semanas.
    const correcciones = mesDeBonos
      ? await getCorreccionesDelMes(renglones.map((r) => r.entityId), mesDeBonos)
      : new Map<string, DiaFichero[]>();
    // Los meses que se pueden elegir: el de la semana y los tres anteriores, salvo los que ya van en otra.
    const yaPagados = new Set(
      (await prisma.planillaDeSueldos.findMany({ where: { bonosDe: { not: null }, id: { not: planilla.id } }, select: { bonosDe: true } })).map(
        (p) => p.bonosDe!
      )
    );
    const mesesPosibles: string[] = [];
    for (let m = mesDe(planilla.hasta), i = 0; i < 4; m = mesAnterior(m), i++) if (!yaPagados.has(m)) mesesPosibles.push(m);
    const filas = renglones.map((r) => {
      const e = porId.get(r.entityId);
      const tarifa = e ? tarifaVigente(e.tarifasDeEmpleado, planilla.desde) : null;
      const texto = (v: { toString(): string } | null) => (v === null ? "" : formatNumeroExacto(v.toString()));
      return {
        id: r.id,
        nombre: r.entity.name,
        slug: r.entity.slug,
        tarifa: tarifa ? tarifa.monto.toString() : null,
        saldoAnterior: (e?.saldo ?? ZERO).toString(),
        horas: r.horas.isZero() ? "" : texto(r.horas),
        feriado: r.horasFeriado.isZero() ? "" : texto(r.horasFeriado),
        presentismo: r.presentismo,
        puntualidad: r.puntualidad,
        monotributo: texto(r.monotributo),
        acuenta: texto(r.descuentoACuenta),
        pagado: texto(r.pagado),
        comentario: r.comentario ?? "",
        dias: (r.dias as DiaFichero[] | null) ?? null,
        diasDelMes: r.diasDelMes
          ? conCorrecciones(r.diasDelMes as unknown as DiaFichero[], correcciones.get(r.entityId) ?? [])
          : null,
      };
    });
    const reglas = await getReglasFichero();
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {encabezado}
          <div className="flex items-center gap-2">
            {canEdit && semanal && (
              <FormModal triggerLabel="Importar del fichero" title="Importar del fichero" action={importarFichero} iconName="plus">
                <input type="hidden" name="planillaId" value={planilla.id} />
                <p className="text-sm text-foreground/80">
                  El Excel que se baja del reloj (AllReport). Se cargan las horas de cada uno con las reglas del fichero;
                  después se puede corregir día por día. Los bonos no: son del mes y se importan aparte.
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-foreground/60">
                  <li>Los viernes se cuentan hasta las 19; los días a los que les falta una marca quedan en amarillo.</li>
                  <li>Si ya se había importado, se vuelve a calcular y se conservan las correcciones a mano.</li>
                  <li>Marcá los feriados de la semana en la planilla, antes o después de importar.</li>
                </ul>
                <input
                  type="file"
                  name="archivo"
                  required
                  accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-foreground/10 file:px-3 file:py-2 file:text-sm"
                />
                <button type="submit" className={buttonClass("primario", "w-fit")}>
                  Importar
                </button>
              </FormModal>
            )}
            {bajarExcel}
            {canEdit && (
              <DeleteButton
              action={borrarPlanilla}
              hiddenName="planillaId"
              hiddenValue={planilla.id}
              nombre={`el borrador de la ${nombreDePlanilla(planilla).toLowerCase()}`}
              consecuencia="Se pierden las horas cargadas. No había movido plata."
              />
            )}
          </div>
        </div>
        {importacion.bonos !== undefined && (
          <div className="space-y-1 rounded-xl border border-foreground/10 bg-foreground/[0.03] px-4 py-3 text-sm">
            <p>
              Se calcularon los bonos de {nombreBonos} de <strong>{importacion.bonos}</strong> empleados con el fichero del mes.
              {Number(importacion.pendientes) > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {" "}
                  Hay {importacion.pendientes} {Number(importacion.pendientes) === 1 ? "día" : "días"} del mes con una marca de
                  menos: a esos no se les sugiere el presentismo. Mirá el motivo debajo de cada casilla.
                </span>
              )}
            </p>
            {importacion.sinMarcas && <p className="text-foreground/70">No encontré en el fichero a: {importacion.sinMarcas}.</p>}
            {importacion.ambiguos && (
              <p className="text-foreground/70">Hay más de uno con el mismo nombre en el fichero para: {importacion.ambiguos}.</p>
            )}
          </div>
        )}
        {semanal && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-foreground/10 px-4 py-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{nombreBonos ? `Esta semana paga los bonos de ${nombreBonos}` : "Esta semana no paga bonos"}</p>
              <p className="text-xs text-foreground/60">
                Presentismo y puntualidad son por mes: un jornal cada uno, con el jornal de esta semana. Se paga cada mes una
                sola vez, en la semana que se elija.
              </p>
            </div>
            {canEdit && (
              <FormConError action={elegirBonosDe} submitLabel={nombreBonos ? "Cambiar" : "Pagar estos bonos"} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="planillaId" value={planilla.id} />
                <select
                  name="mes"
                  defaultValue={mesDeBonos ?? ""}
                  aria-label="Mes de los bonos"
                  className={controlClass({ denso: true, extra: "w-auto" })}
                >
                  <option value="">Sin bonos</option>
                  {[...new Set([...(mesDeBonos ? [mesDeBonos] : []), ...mesesPosibles])].sort().reverse().map((m) => (
                    <option key={m} value={m}>
                      Bonos de {nombreDelMes(m, planilla.fechaDePago.toISOString())}
                    </option>
                  ))}
                </select>
              </FormConError>
            )}
            {canEdit && mesDeBonos && (
              <FormModal triggerLabel={`Fichero de ${nombreBonos}`} title={`Fichero de ${nombreBonos}`} action={importarFicheroDelMes} iconName="plus">
                <input type="hidden" name="planillaId" value={planilla.id} />
                <p className="text-sm text-foreground/80">
                  El AllReport del mes entero ({rangoDelMes(mesDeBonos).desde.split("-").reverse().join("/")} al{" "}
                  {rangoDelMes(mesDeBonos).hasta.split("-").reverse().join("/")}). Se marcan presentismo y puntualidad de cada uno
                  con las reglas del fichero, y quedan para corregir.
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-foreground/60">
                  <li>Presentismo: todos los días hábiles del mes con {reglas.presentismoHoras} h o más. Los feriados del mes no cuentan.</li>
                  <li>Puntualidad: todos los días hábiles del mes entrando hasta las {reglas.entradaPuntual}, y además el presentismo.</li>
                  <li>Lo que se corrigió con las cámaras en las semanas de ese mes se tiene en cuenta.</li>
                </ul>
                <input
                  type="file"
                  name="archivo"
                  required
                  accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-foreground/10 file:px-3 file:py-2 file:text-sm"
                />
                <button type="submit" className={buttonClass("primario", "w-fit")}>
                  Importar
                </button>
              </FormModal>
            )}
          </div>
        )}
        {importacion.importados !== undefined && (
          <div className="space-y-1 rounded-xl border border-foreground/10 bg-foreground/[0.03] px-4 py-3 text-sm">
            <p>
              Se importaron las marcas de <strong>{importacion.importados}</strong> empleados.
              {Number(importacion.pendientes) > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {" "}
                  Hay {importacion.pendientes} {Number(importacion.pendientes) === 1 ? "día" : "días"} con una marca de menos: tocá
                  «ver días» en los que dicen «sin marca» y completalos con las cámaras.
                </span>
              )}
            </p>
            {importacion.sinMarcas && (
              <p className="text-foreground/70">
                No encontré en el fichero a: {importacion.sinMarcas}. Revisá su número de fichero en Sueldos, o cargá sus horas
                a mano.
              </p>
            )}
            {importacion.ambiguos && (
              <p className="text-foreground/70">
                Hay más de uno con el mismo nombre en el fichero para: {importacion.ambiguos}. Cargales el número de fichero en
                Sueldos y volvé a importar.
              </p>
            )}
            {importacion.diasFuera && (
              <p className="text-foreground/70">El archivo no trae estos días de la semana: {importacion.diasFuera}.</p>
            )}
          </div>
        )}
        <PlanillaDeSueldosGrid
          planillaId={planilla.id}
          forma={planilla.forma}
          fechaDePago={toDateInputValue(planilla.fechaDePago)}
          cajaId={planilla.cajaId}
          notas={planilla.notas ?? ""}
          cajas={cajas.map((c) => ({ id: c.id, name: c.name }))}
          filas={filas}
          puedeEditar={canEdit}
          action={guardarPlanilla}
          semana={{ desde: fechaISO(planilla.desde), hasta: fechaISO(planilla.hasta) }}
          feriadosIniciales={planilla.feriados}
          reglas={reglas}
          bonos={
            mesDeBonos
              ? { nombre: nombreBonos!, ...rangoDelMes(mesDeBonos), feriadosIniciales: planilla.feriadosDelMes }
              : null
          }
        />
      </div>
    );
  }

  // Cerrada: los números con los que se cerró, que son los que están en las cuentas.
  const cerradas = renglones.map((r) => ({
    r,
    cuenta: r.tarifa
      ? cuentaDelRenglon({
          forma: planilla.forma,
          tarifa: r.tarifa,
          horas: r.horas,
          horasFeriado: r.horasFeriado,
          ...bonosDelRenglon(planilla, r),
          monotributo: r.monotributo ?? ZERO,
          saldoAnterior: r.saldoAnterior ?? ZERO,
          descuentoACuenta: r.descuentoACuenta,
          pagado: r.pagado,
        })
      : null,
  }));
  const total = (pick: (c: NonNullable<(typeof cerradas)[number]["cuenta"]>) => { toString(): string }) =>
    sumDecimals(cerradas.map(({ cuenta }) => (cuenta ? pick(cuenta).toString() : 0)));
  const conACuenta = cerradas.some(({ cuenta }) => cuenta?.descuentoACuenta.greaterThan(0) || cuenta?.deudaAnterior.greaterThan(0));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {encabezado}
        <div className="flex flex-wrap gap-2">
          {bajarExcel}
          {caja && (
            <Link href={`/cuentas-corrientes/${caja.slug}`} className={buttonClass("secundario")}>
              Ver {caja.name}
            </Link>
          )}
          {canEdit && (
            <FormModal triggerLabel="Reabrir" title="¿Reabrir la planilla?" action={reabrirPlanilla} peso="secundario" iconName="edit">
              <input type="hidden" name="planillaId" value={planilla.id} />
              <p className="text-sm text-foreground/80">
                Se borran los sueldos y los pagos que cargó en la cuenta de cada empleado, y la plata vuelve a{" "}
                {caja?.name ?? "la caja"}. Las horas y los montos quedan como estaban, para corregir y volver a cerrar.
              </p>
              <button type="submit" className={buttonClass("primario", "w-fit")}>
                Reabrir
              </button>
            </FormModal>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-foreground/10">
        <table className="w-full text-sm tabular-nums">
          <thead className="bg-foreground/[0.03] text-left text-xs text-foreground/60">
            <tr>
              <th className={celda}>Empleado</th>
              {semanal && <th className={`${celda} text-right`}>Horas</th>}
              {semanal && <th className={`${celda} text-right`}>Feriado</th>}
              {semanal && nombreBonos && <th className={`${celda} text-right`}>Bonos de {nombreBonos}</th>}
              {!semanal && <th className={`${celda} text-right`}>Monotributo</th>}
              <th className={`${celda} text-right`}>Sueldo</th>
              {conACuenta && <th className={`${celda} text-right`}>A cuenta</th>}
              <th className={`${celda} text-right`}>A pagar</th>
              <th className={`${celda} text-right`}>En efectivo</th>
              <th className={celda}>Comentario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/10">
            {cerradas.map(({ r, cuenta }) => (
              <tr key={r.id}>
                <td className={celda}>
                  <Link href={`/cuentas-corrientes/${r.entity.slug}`} className="font-medium hover:underline">
                    {r.entity.name}
                  </Link>
                  {r.tarifa && (
                    <p className="text-xs text-foreground/50">
                      {semanal ? `Jornal ${formatMoney(r.tarifa)}` : `${formatMoney(r.tarifa)} por mes`}
                    </p>
                  )}
                </td>
                {semanal && <td className={`${celda} text-right`}>{formatNumeroExacto(r.horas)}</td>}
                {semanal && <td className={`${celda} text-right`}>{r.horasFeriado.isZero() ? "" : formatNumeroExacto(r.horasFeriado)}</td>}
                {semanal && nombreBonos && (
                  <td className={`${celda} text-right`}>
                    {[r.presentismo ? "presentismo" : null, r.puntualidad ? "puntualidad" : null].filter(Boolean).join(" + ")}
                    {cuenta?.bonos.greaterThan(0) && <span className="block text-xs text-foreground/50">{formatMoney(cuenta.bonos)}</span>}
                  </td>
                )}
                {!semanal && <td className={`${celda} text-right`}>{cuenta?.monotributo.greaterThan(0) ? formatMoney(cuenta.monotributo) : ""}</td>}
                <td className={`${celda} text-right`}>{cuenta ? formatMoney(cuenta.sueldo) : "—"}</td>
                {conACuenta && (
                  <td className={`${celda} text-right`}>
                    {cuenta?.descuentoACuenta.greaterThan(0)
                      ? `− ${formatMoney(cuenta.descuentoACuenta)}`
                      : cuenta?.deudaAnterior.greaterThan(0)
                        ? `+ ${formatMoney(cuenta.deudaAnterior)}`
                        : ""}
                  </td>
                )}
                <td className={`${celda} text-right`}>{cuenta ? formatMoney(cuenta.aPagar) : "—"}</td>
                <td className={`${celda} text-right font-medium`}>{cuenta ? formatMoney(cuenta.pagado) : "—"}</td>
                <td className={`${celda} text-foreground/70`}>{r.comentario}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-foreground/15 font-semibold">
            <tr>
              <td className={celda}>Total</td>
              {semanal && <td className={`${celda} text-right`}>{formatNumeroExacto(sumDecimals(renglones.map((r) => r.horas)))}</td>}
              {semanal && <td />}
              {semanal && nombreBonos && <td className={`${celda} text-right`}>{formatMoney(total((c) => c.bonos))}</td>}
              {!semanal && <td className={`${celda} text-right`}>{formatMoney(total((c) => c.monotributo))}</td>}
              <td className={`${celda} text-right`}>{formatMoney(total((c) => c.sueldo))}</td>
              {conACuenta && <td />}
              <td className={`${celda} text-right`}>{formatMoney(total((c) => c.aPagar))}</td>
              <td className={`${celda} text-right`}>{formatMoney(total((c) => c.pagado))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {planilla.notas && <p className="text-sm text-foreground/70">Notas: {planilla.notas}</p>}
    </div>
  );
}
