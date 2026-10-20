import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatMoney, sumDecimals, ZERO } from "@/lib/money";
import { formatFecha, hoyComoFecha, toDateInputValue } from "@/lib/period";
import { valorHora } from "@/lib/sueldos-calculo";
import { getCajasDeSueldos, getEmpleados, nombreDePlanilla, proximoPeriodo, tarifaVigente } from "@/lib/sueldos";
import { FormModal } from "@/components/Modal";
import { BotonConError } from "@/components/BotonConError";
import { EmpleadoFormFields } from "@/components/EmpleadoFormFields";
import { buttonClass } from "@/components/ui/Button";
import { controlClass } from "@/components/ui/Field";
import { cambiarTarifa, crearEmpleado, crearPlanilla, darDeBajaEmpleado } from "./actions";

export default async function SueldosPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";
  const hoy = hoyComoFecha();

  const [empleados, planillas, cajas, semana, mes, proveedores] = await Promise.all([
    getEmpleados({ conBajas: true }),
    prisma.planillaDeSueldos.findMany({
      orderBy: [{ desde: "desc" }, { forma: "asc" }],
      take: 40,
      include: { renglones: { include: { gasto: { select: { totalAmount: true } }, pago: { select: { amount: true } } } } },
    }),
    getCajasDeSueldos(),
    proximoPeriodo("SEMANAL", hoy),
    proximoPeriodo("MENSUAL", hoy),
    prisma.entity.findMany({ where: { type: "PROVEEDOR", formaDeSueldo: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const activos = empleados.filter((e) => !e.empleadoBaja);
  const bajas = empleados.filter((e) => e.empleadoBaja);
  const hayMensuales = activos.some((e) => e.forma === "MENSUAL");
  const nombreDeCaja = new Map(cajas.map((c) => [c.id, c.name]));

  const formPlanilla = (forma: "SEMANAL" | "MENSUAL", p: { desde: Date; hasta: Date; fechaDePago: Date }) => (
    <>
      <input type="hidden" name="forma" value={forma} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor={`desde-${forma}`}>
            Desde
          </label>
          <input id={`desde-${forma}`} type="date" name="desde" required defaultValue={toDateInputValue(p.desde)} className={controlClass()} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor={`hasta-${forma}`}>
            Hasta
          </label>
          <input id={`hasta-${forma}`} type="date" name="hasta" required defaultValue={toDateInputValue(p.hasta)} className={controlClass()} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor={`pago-${forma}`}>
            Se paga el
          </label>
          <input id={`pago-${forma}`} type="date" name="fechaDePago" required defaultValue={toDateInputValue(p.fechaDePago)} className={controlClass()} />
        </div>
      </div>
      <p className="text-xs text-foreground/50">
        Entran todos los empleados que cobran {forma === "SEMANAL" ? "por semana" : "por mes"}. Hasta que la cerrás no mueve
        plata: podés cargar las horas de a poco y guardar.
      </p>
      <button type="submit" className={buttonClass("primario", "w-fit")}>
        Armar la planilla
      </button>
    </>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-xl font-semibold">Sueldos</h1>
          <p className="max-w-prose text-sm text-foreground/60">
            La planilla de cada semana con las horas del fichero y los feriados. Al cerrarla, a cada uno se le carga su
            sueldo y lo que se le dio desde la caja; lo que ya cobró a cuenta se descuenta solo.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <FormModal triggerLabel="Nueva semana" title="Nueva semana" action={crearPlanilla}>
              {formPlanilla("SEMANAL", semana)}
            </FormModal>
            {hayMensuales && (
              <FormModal triggerLabel="Liquidar mes" title="Sueldos del mes" action={crearPlanilla} peso="secundario">
                {formPlanilla("MENSUAL", mes)}
              </FormModal>
            )}
            <FormModal triggerLabel="Nuevo empleado" title="Nuevo empleado" action={crearEmpleado} peso="secundario">
              <EmpleadoFormFields proveedores={proveedores} />
            </FormModal>
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Planillas</h2>
        {planillas.length === 0 ? (
          <p className="rounded-xl border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/40">
            Todavía no hay ninguna. Arrancá con «Nueva semana».
          </p>
        ) : (
          <ul className="divide-y divide-foreground/10 rounded-xl border border-foreground/10">
            {planillas.map((p) => {
              const cerrada = p.estado === "CERRADA";
              const gasto = sumDecimals(p.renglones.map((r) => r.gasto?.totalAmount ?? ZERO));
              const efectivo = sumDecimals(p.renglones.map((r) => r.pago?.amount ?? ZERO));
              return (
                <li key={p.id}>
                  <Link href={`/sueldos/${p.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-foreground/[0.03]">
                    <span className="min-w-0">
                      <span className="font-medium">{nombreDePlanilla(p)}</span>
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${
                          cerrada
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        }`}
                      >
                        {cerrada ? "Pagada" : "Borrador"}
                      </span>
                      <span className="block text-xs text-foreground/50">
                        {p.renglones.length} empleados · se paga el {formatFecha(p.fechaDePago)}
                        {p.cajaId ? ` · ${nombreDeCaja.get(p.cajaId) ?? ""}` : ""}
                      </span>
                    </span>
                    {cerrada && (
                      <span className="text-right text-sm tabular-nums">
                        {formatMoney(efectivo)} en efectivo
                        <span className="block text-xs text-foreground/50">sueldos {formatMoney(gasto)}</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Empleados</h2>
        {activos.length === 0 ? (
          <p className="rounded-xl border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/40">
            Todavía no hay empleados cargados.
          </p>
        ) : (
          <ul className="divide-y divide-foreground/10 rounded-xl border border-foreground/10">
            {activos.map((e) => {
              const tarifa = tarifaVigente(e.tarifasDeEmpleado, hoy) ?? e.tarifasDeEmpleado.at(-1) ?? null;
              const proxima = e.tarifasDeEmpleado.find((t) => t.desde > hoy);
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0">
                    <Link href={`/cuentas-corrientes/${e.slug}`} className="font-medium hover:underline">
                      {e.name}
                    </Link>
                    <p className="text-xs tabular-nums text-foreground/50">
                      {tarifa
                        ? e.forma === "SEMANAL"
                          ? `Jornal ${formatMoney(tarifa.monto)} · hora ${formatMoney(valorHora(tarifa.monto))} desde el ${formatFecha(tarifa.desde)}`
                          : `${formatMoney(tarifa.monto)} por mes desde el ${formatFecha(tarifa.desde)}`
                        : "Sin jornal cargado"}
                      {proxima ? ` · ${formatMoney(proxima.monto)} desde el ${formatFecha(proxima.desde)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-right text-sm tabular-nums">
                      {e.saldo.greaterThan(0.005) ? (
                        <span className="text-amber-700 dark:text-amber-400">Le debemos {formatMoney(e.saldo)}</span>
                      ) : e.saldo.lessThan(-0.005) ? (
                        <span>Tiene a cuenta {formatMoney(e.saldo.negated())}</span>
                      ) : (
                        <span className="text-foreground/50">Al día</span>
                      )}
                      {e.pendienteCuenta1.greaterThan(0) && (
                        <span className="block text-xs text-foreground/50">
                          Cuenta 1 por descontar {formatMoney(e.pendienteCuenta1)}
                        </span>
                      )}
                    </span>
                    {canEdit && (
                      <>
                        <FormModal
                          triggerLabel={e.forma === "SEMANAL" ? "Cambiar jornal" : "Cambiar sueldo"}
                          title={`${e.forma === "SEMANAL" ? "Jornal" : "Sueldo"} de ${e.name}`}
                          action={cambiarTarifa}
                          soloIcono
                          iconName="edit"
                        >
                          <input type="hidden" name="empleadoId" value={e.id} />
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-sm" htmlFor={`monto-${e.id}`}>
                                {e.forma === "SEMANAL" ? "Jornal (8 horas)" : "Sueldo del mes"}
                              </label>
                              <input id={`monto-${e.id}`} name="monto" required inputMode="decimal" className={controlClass()} />
                            </div>
                            <div className="space-y-1">
                              <label className="text-sm" htmlFor={`desde-${e.id}`}>
                                Desde
                              </label>
                              <input id={`desde-${e.id}`} type="date" name="desde" required defaultValue={toDateInputValue(hoy)} className={controlClass()} />
                            </div>
                          </div>
                          <p className="text-xs text-foreground/50">
                            Las semanas que empiezan antes de esa fecha siguen con el jornal que tenían.
                          </p>
                          <button type="submit" className={buttonClass("primario", "w-fit")}>
                            Guardar
                          </button>
                        </FormModal>
                        <BotonConError
                          action={darDeBajaEmpleado}
                          hidden={{ empleadoId: e.id }}
                          className="rounded px-2 py-1 text-xs text-foreground/50 hover:bg-foreground/5 hover:text-foreground"
                        >
                          Dar de baja
                        </BotonConError>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-foreground/50">
          Un adelanto se carga como un pago en la ficha del empleado; si un cliente le transfiere directo, como cobro del
          cliente «Directo a un proveedor o empleado». En la planilla siguiente aparece a cuenta y se le descuenta.
        </p>
        {bajas.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-foreground/60">Dados de baja ({bajas.length})</summary>
            <ul className="mt-2 space-y-1">
              {bajas.map((e) => (
                <li key={e.id} className="flex items-center gap-3">
                  <Link href={`/cuentas-corrientes/${e.slug}`} className="hover:underline">
                    {e.name}
                  </Link>
                  {canEdit && (
                    <BotonConError
                      action={darDeBajaEmpleado}
                      hidden={{ empleadoId: e.id, reactivar: "1" }}
                      className="rounded px-2 py-1 text-xs text-foreground/50 hover:bg-foreground/5 hover:text-foreground"
                    >
                      Reactivar
                    </BotonConError>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
