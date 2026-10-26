import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatMoney, formatNumeroExacto, sumDecimals, ZERO } from "@/lib/money";
import { formatFecha, toDateInputValue } from "@/lib/period";
import { cuentaDelRenglon } from "@/lib/sueldos-calculo";
import { fechaISO, getCajasDeSueldos, getEmpleados, getReglasFichero, nombreDePlanilla, tarifaVigente } from "@/lib/sueldos";
import type { DiaFichero } from "@/lib/fichero-calculo";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { PlanillaDeSueldosGrid } from "@/components/PlanillaDeSueldosGrid";
import { buttonClass } from "@/components/ui/Button";
import { borrarPlanilla, guardarPlanilla, reabrirPlanilla } from "../actions";

const celda = "px-2 py-1.5";

export default async function PlanillaPage({ params }: { params: Promise<{ planillaId: string }> }) {
  const { planillaId } = await params;
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

  if (planilla.estado === "BORRADOR") {
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
      };
    });
    const reglas = await getReglasFichero();
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {encabezado}
          <div className="flex items-center gap-2">
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
          presentismo: r.presentismo,
          puntualidad: r.puntualidad,
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
              {semanal && <th className={`${celda} text-right`}>Bonos</th>}
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
                {semanal && (
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
              {semanal && <td className={`${celda} text-right`}>{formatMoney(total((c) => c.bonos))}</td>}
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
