"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Prisma, type FormaDeSueldo } from "@prisma/client";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";
import { formatMoney, parseNumeroSuave } from "@/lib/money";
import { cuentaDelRenglon, valorHora } from "@/lib/sueldos-calculo";
import { buttonClass } from "./ui/Button";
import { controlClass } from "./ui/Field";
import { segmentoClass, segmentosClass } from "./ui/Segmentos";
import { useEnvioUnico } from "./useEnvioUnico";

export type FilaDePlanilla = {
  id: string;
  nombre: string;
  slug: string;
  /** El jornal (semanal) o el sueldo del mes vigente; null si no tiene cargado. */
  tarifa: string | null;
  saldoAnterior: string;
  horas: string;
  feriado: string;
  presentismo: boolean;
  puntualidad: boolean;
  /** Por mes: el monotributo que se le reintegra. */
  monotributo: string;
  acuenta: string;
  pagado: string;
  comentario: string;
};

type Campo = "horas" | "feriado" | "monotributo" | "acuenta" | "pagado" | "comentario";

const D = (v: string) => new Prisma.Decimal(v);
const leer = (s: string) => (s.trim() ? parseNumeroSuave(s) : null);
const celda = "px-2 py-1.5";
/** Los importes sueltos, a la altura del texto de los casilleros de al lado. */
const importe = `${celda} pt-3.5 text-right tabular-nums whitespace-nowrap`;
const entrada = controlClass({ denso: true, extra: "text-right tabular-nums min-w-[4.5rem]" });
const entradaPlata = controlClass({ denso: true, extra: "text-right tabular-nums min-w-[8.5rem]" });

/**
 * La planilla de la semana (o del mes) para cargar: horas, feriados y los dos bonos de cada uno
 * —presentismo y puntualidad, un jornal cada uno—, y la app hace la cuenta en vivo. Por mes, el
 * sueldo y el monotributo. Lo que va en gris es lo que sugiere —descontar todo lo que
 * tiene a cuenta, redondear para arriba a $ 50— y sólo se escribe encima cuando hay que cambiarlo.
 */
export function PlanillaDeSueldosGrid({
  planillaId,
  forma,
  fechaDePago,
  cajaId,
  notas,
  cajas,
  filas,
  puedeEditar,
  action,
}: {
  planillaId: string;
  forma: FormaDeSueldo;
  fechaDePago: string;
  cajaId: string | null;
  notas: string;
  cajas: { id: string; name: string }[];
  filas: FilaDePlanilla[];
  puedeEditar: boolean;
  action: (formData: FormData) => Promise<void>;
}) {
  const [valores, setValores] = useState(() => Object.fromEntries(filas.map((f) => [f.id, f])));
  const [caja, setCaja] = useState(cajaId ?? cajas[0]?.id ?? "");
  const confirmar = useRef<HTMLDialogElement>(null);
  const [error, formAction, pending] = useActionState<string | null, FormData>(async (_prev, formData) => {
    try {
      await action(formData);
      confirmar.current?.close();
      return null;
    } catch (e) {
      if (esSenalDeNavegacion(e)) throw e;
      return userErrorMessage(e);
    }
  }, null);
  const unaVez = useEnvioUnico(pending);

  const cambiar = (id: string, campo: Campo, valor: string) =>
    setValores((v) => ({ ...v, [id]: { ...v[id], [campo]: valor } }));
  const marcar = (id: string, bono: "presentismo" | "puntualidad", valor: boolean) =>
    setValores((v) => ({ ...v, [id]: { ...v[id], [bono]: valor } }));

  const semanal = forma === "SEMANAL";
  const cuentas = filas.map((f) => {
    const v = valores[f.id];
    const cuenta = f.tarifa
      ? cuentaDelRenglon({
          forma,
          tarifa: D(f.tarifa),
          horas: leer(v.horas) ?? D("0"),
          horasFeriado: leer(v.feriado) ?? D("0"),
          presentismo: v.presentismo,
          puntualidad: v.puntualidad,
          monotributo: leer(v.monotributo) ?? D("0"),
          saldoAnterior: D(f.saldoAnterior),
          descuentoACuenta: leer(v.acuenta),
          pagado: leer(v.pagado),
        })
      : null;
    return { f, v, cuenta };
  });
  const suma = (pick: (c: NonNullable<(typeof cuentas)[number]["cuenta"]>) => Prisma.Decimal) =>
    cuentas.reduce((acc, { cuenta }) => (cuenta ? acc.plus(pick(cuenta)) : acc), D("0"));
  const totalSueldo = suma((c) => c.sueldo);
  const totalEfectivo = suma((c) => c.pagado);
  const totalHoras = cuentas.reduce((acc, { v }) => acc.plus(leer(v.horas) ?? 0), D("0"));
  const conACuenta = cuentas.some(({ cuenta, v }) => cuenta?.aCuenta.greaterThan(0) || cuenta?.deudaAnterior.greaterThan(0) || v.acuenta);
  const nombreCaja = cajas.find((c) => c.id === caja)?.name ?? "la caja";
  const conDatos = cuentas.filter(({ cuenta }) => cuenta && (cuenta.gasto.greaterThan(0) || cuenta.pagado.greaterThan(0))).length;

  return (
    <form action={formAction} onSubmit={unaVez} className="space-y-4">
      <input type="hidden" name="planillaId" value={planillaId} />

      <div className="overflow-x-auto rounded-xl border border-foreground/10">
        <table className="w-full text-sm">
          <thead className="whitespace-nowrap bg-foreground/[0.03] text-left text-xs text-foreground/60">
            <tr>
              <th className={celda}>Empleado</th>
              {semanal && <th className={`${celda} text-right`}>Horas</th>}
              {semanal && (
                <th className={`${celda} text-right`} title="Las horas trabajadas en feriado, que ya están dentro de las horas: van al valor hora más 0,5.">
                  Feriado
                </th>
              )}
              {semanal && (
                <th className={`${celda} text-center`} title="Bono de un jornal por presentismo.">
                  Presentismo
                </th>
              )}
              {semanal && (
                <th className={`${celda} text-center`} title="Bono de un jornal por puntualidad.">
                  Puntualidad
                </th>
              )}
              {!semanal && (
                <th className={`${celda} text-right`} title="Lo que paga de monotributo ese mes: se le reintegra con el sueldo.">
                  Monotributo
                </th>
              )}
              <th className={`${celda} text-right`}>Sueldo</th>
              {conACuenta && (
                <th className={`${celda} text-right`} title="Lo que ya cobró a cuenta: adelantos, o un cliente que le pagó directo.">
                  A cuenta
                </th>
              )}
              <th className={`${celda} text-right`}>A pagar</th>
              <th className={`${celda} text-right`}>En efectivo</th>
              <th className={celda}>Comentario</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/10">
            {cuentas.map(({ f, v, cuenta }) => (
              <tr key={f.id} className="align-top">
                <td className={`${celda} min-w-[10rem]`}>
                  <Link href={`/cuentas-corrientes/${f.slug}`} className="font-medium hover:underline">
                    {f.nombre}
                  </Link>
                  <p className="text-xs tabular-nums text-foreground/50">
                    {f.tarifa
                      ? semanal
                        ? `Jornal ${formatMoney(D(f.tarifa))} · hora ${formatMoney(valorHora(D(f.tarifa)))}`
                        : `${formatMoney(D(f.tarifa))} por mes`
                      : "Sin jornal cargado"}
                  </p>
                </td>
                {semanal && (
                  <td className={celda}>
                    <input
                      name={`horas_${f.id}`}
                      inputMode="decimal"
                      value={v.horas}
                      onChange={(e) => cambiar(f.id, "horas", e.target.value)}
                      disabled={!puedeEditar}
                      placeholder="0"
                      aria-label={`Horas de ${f.nombre}`}
                      className={entrada}
                    />
                  </td>
                )}
                {semanal && (
                  <td className={celda}>
                    <input
                      name={`feriado_${f.id}`}
                      inputMode="decimal"
                      value={v.feriado}
                      onChange={(e) => cambiar(f.id, "feriado", e.target.value)}
                      disabled={!puedeEditar}
                      placeholder="0"
                      aria-label={`Horas en feriado de ${f.nombre}`}
                      className={entrada}
                    />
                  </td>
                )}
                {semanal &&
                  (["presentismo", "puntualidad"] as const).map((bono) => (
                    <td key={bono} className={`${celda} pt-3 text-center`}>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs tabular-nums text-foreground/60">
                        <input
                          type="checkbox"
                          name={`${bono}_${f.id}`}
                          checked={v[bono]}
                          onChange={(e) => marcar(f.id, bono, e.target.checked)}
                          disabled={!puedeEditar}
                          aria-label={`Bono de ${bono} de ${f.nombre}`}
                          className="h-4 w-4"
                        />
                        {v[bono] && f.tarifa ? formatMoney(D(f.tarifa)) : ""}
                      </label>
                    </td>
                  ))}
                {!semanal && (
                  <td className={celda}>
                    <input
                      name={`monotributo_${f.id}`}
                      inputMode="decimal"
                      value={v.monotributo}
                      onChange={(e) => cambiar(f.id, "monotributo", e.target.value)}
                      disabled={!puedeEditar}
                      placeholder="0"
                      aria-label={`Monotributo de ${f.nombre}`}
                      className={entradaPlata}
                    />
                  </td>
                )}
                <td className={importe}>
                  {cuenta ? formatMoney(cuenta.sueldo) : "—"}
                  {cuenta && (cuenta.porFeriado.greaterThan(0) || cuenta.bonos.greaterThan(0)) && (
                    <p className="text-[11px] font-normal text-foreground/50">
                      {[
                        `${formatMoney(cuenta.porHoras)} horas`,
                        cuenta.porFeriado.greaterThan(0) ? `${formatMoney(cuenta.porFeriado)} feriado` : null,
                        cuenta.bonos.greaterThan(0) ? `${formatMoney(cuenta.bonos)} bonos` : null,
                      ]
                        .filter(Boolean)
                        .join(" + ")}
                    </p>
                  )}
                </td>
                {conACuenta && (
                  <td className={celda}>
                    {cuenta?.aCuenta.greaterThan(0) || v.acuenta ? (
                      <>
                        <input
                          name={`acuenta_${f.id}`}
                          inputMode="decimal"
                          value={v.acuenta}
                          onChange={(e) => cambiar(f.id, "acuenta", e.target.value)}
                          disabled={!puedeEditar}
                          placeholder={cuenta ? formatMoney(cuenta.descuentoACuenta) : ""}
                          aria-label={`Lo que se le descuenta de lo que tiene a cuenta ${f.nombre}`}
                          className={entradaPlata}
                        />
                        <p className="mt-0.5 text-right text-[11px] text-foreground/50">
                          tiene {formatMoney(cuenta?.aCuenta ?? 0)}
                          {cuenta?.quedaACuenta.greaterThan(0) ? ` · le quedan ${formatMoney(cuenta.quedaACuenta)}` : ""}
                        </p>
                      </>
                    ) : cuenta?.deudaAnterior.greaterThan(0) ? (
                      <p className="text-right text-xs tabular-nums text-amber-700 dark:text-amber-400">
                        + {formatMoney(cuenta.deudaAnterior)} de antes
                      </p>
                    ) : null}
                  </td>
                )}
                <td className={importe}>{cuenta ? formatMoney(cuenta.aPagar) : "—"}</td>
                <td className={celda}>
                  <input
                    name={`pagado_${f.id}`}
                    inputMode="decimal"
                    value={v.pagado}
                    onChange={(e) => cambiar(f.id, "pagado", e.target.value)}
                    disabled={!puedeEditar}
                    placeholder={cuenta ? formatMoney(cuenta.pagadoSugerido) : ""}
                    aria-label={`Lo que se le da en efectivo a ${f.nombre}`}
                    className={`${entradaPlata} font-medium`}
                  />
                  {cuenta?.quedaDebiendo.greaterThan(0) && (
                    <p className="mt-0.5 text-right text-[11px] text-amber-700 dark:text-amber-400">
                      le queda {formatMoney(cuenta.quedaDebiendo)} para la próxima
                    </p>
                  )}
                </td>
                <td className={celda}>
                  <input
                    name={`comentario_${f.id}`}
                    value={v.comentario}
                    onChange={(e) => cambiar(f.id, "comentario", e.target.value)}
                    disabled={!puedeEditar}
                    aria-label={`Comentario de ${f.nombre}`}
                    className={controlClass({ denso: true, extra: "min-w-[10rem]" })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-foreground/15 font-semibold tabular-nums">
            <tr>
              <td className={celda}>Total</td>
              {semanal && <td className={`${celda} text-right`}>{totalHoras.toString().replace(".", ",")}</td>}
              {semanal && <td />}
              {semanal && <td />}
              {semanal && <td />}
              {!semanal && <td className={`${celda} text-right`}>{formatMoney(suma((c) => c.monotributo))}</td>}
              <td className={`${celda} text-right`}>{formatMoney(totalSueldo)}</td>
              {conACuenta && <td />}
              <td className={`${celda} text-right`}>{formatMoney(suma((c) => c.aPagar))}</td>
              <td className={`${celda} text-right`}>{formatMoney(totalEfectivo)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-foreground/50">
        {semanal
          ? "Horas al valor hora (jornal ÷ 8); las de feriado, que van dentro de las horas, al valor hora más 0,5. Presentismo y puntualidad suman un jornal cada uno. "
          : "El sueldo del mes más el monotributo, que arranca con el del mes anterior. "}
        Lo que está en gris es lo que sugiere la app: se descuenta todo lo que tiene a cuenta y se redondea para arriba a
        los $ 50. Escribí encima sólo si hay que cambiarlo (un adelanto que se descuenta en partes, el redondeo según los
        billetes). Los pesos de más del redondeo no se descuentan la semana siguiente.
      </p>

      <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="fechaDePago">
            Se paga el
          </label>
          <input id="fechaDePago" type="date" name="fechaDePago" required defaultValue={fechaDePago} disabled={!puedeEditar} className={controlClass()} />
        </div>
        <div className="space-y-1">
          <p className="text-sm">Sale de</p>
          <div className={segmentosClass}>
            {cajas.map((c) => (
              <label key={c.id} className={segmentoClass}>
                <input
                  type="radio"
                  name="cajaId"
                  value={c.id}
                  checked={caja === c.id}
                  onChange={() => setCaja(c.id)}
                  disabled={!puedeEditar}
                  className="sr-only"
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="notas">
            Notas
          </label>
          <input id="notas" name="notas" defaultValue={notas} disabled={!puedeEditar} className={controlClass()} />
        </div>
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">{error}</p>}

      {puedeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" name="accion" value="guardar" disabled={pending} className={buttonClass("secundario")}>
            {pending ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => confirmar.current?.showModal()}
            className={buttonClass("primario")}
          >
            Cerrar y pagar…
          </button>
          <span className="text-sm text-foreground/60">
            {formatMoney(totalEfectivo)} en efectivo de {nombreCaja}
          </span>
        </div>
      )}

      <dialog
        ref={confirmar}
        onClick={(e) => {
          if (e.target === confirmar.current) confirmar.current?.close();
        }}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-foreground/10 bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40"
      >
        <h2 className="mb-2 text-base font-semibold">¿Cerrar y pagar?</h2>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-foreground/80">
          <li>
            {conDatos === 1 ? "A 1 empleado se le carga" : `A ${conDatos} empleados se les carga`} el sueldo en su cuenta:{" "}
            {formatMoney(totalSueldo)}.
          </li>
          <li>
            Salen <strong>{formatMoney(totalEfectivo)}</strong> en efectivo de <strong>{nombreCaja}</strong>.
          </li>
          <li>Si hay que corregir algo después, se reabre la planilla y se vuelve a cerrar.</li>
        </ul>
        {error && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => confirmar.current?.close()} className={buttonClass("discreto")}>
            Volver
          </button>
          <button type="submit" name="accion" value="cerrar" disabled={pending} className={buttonClass("primario")}>
            {pending ? "Cerrando…" : "Cerrar y pagar"}
          </button>
        </div>
      </dialog>
    </form>
  );
}
