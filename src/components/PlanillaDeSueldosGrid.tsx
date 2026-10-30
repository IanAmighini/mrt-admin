"use client";

import { Fragment, startTransition, useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Prisma, type FormaDeSueldo } from "@prisma/client";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";
import { formatMoney, parseNumeroSuave } from "@/lib/money";
import { cuentaDelRenglon, valorHora } from "@/lib/sueldos-calculo";
import {
  DIAS_SEMANA,
  diaDeLaSemana,
  fechasDe,
  horasYMinutos,
  limpiarMarcas,
  resumenDeSemana,
  type DiaFichero,
  type ReglasFichero,
} from "@/lib/fichero-calculo";
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
  /** Los días importados del fichero; null si las horas se cargan a mano. */
  dias: DiaFichero[] | null;
  /** Los días del mes de los bonos (del fichero de ese mes); null si no se importó. */
  diasDelMes: DiaFichero[] | null;
};

type Campo = "horas" | "feriado" | "monotributo" | "acuenta" | "pagado" | "comentario";

const D = (v: string) => new Prisma.Decimal(v);
const leer = (s: string) => (s.trim() ? parseNumeroSuave(s) : null);
const celda = "px-2 py-1.5";
/** Los importes sueltos, a la altura del texto de los casilleros de al lado. */
const importe = `${celda} pt-3.5 text-right tabular-nums whitespace-nowrap`;
const entrada = controlClass({ denso: true, extra: "text-right tabular-nums min-w-[4.5rem]" });
const entradaPlata = controlClass({ denso: true, extra: "text-right tabular-nums min-w-[8.5rem]" });
const entradaHora = controlClass({ denso: true, extra: "text-center tabular-nums w-full" });

/**
 * La planilla de la semana (o del mes) para cargar: horas y feriados, y la app hace la cuenta en
 * vivo. Si la semana paga los bonos de un mes —presentismo y puntualidad, un jornal cada uno—, una
 * casilla de cada uno, con lo que sugiere el fichero de ese mes. Por mes, el
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
  semana,
  feriadosIniciales,
  reglas,
  bonos,
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
  /** Las fechas de la planilla ("2026-10-17"), para los días y los feriados. */
  semana: { desde: string; hasta: string };
  feriadosIniciales: string[];
  reglas: ReglasFichero;
  /** El mes cuyos bonos paga esta semana; null si no paga. */
  bonos: { nombre: string; desde: string; hasta: string; feriadosIniciales: string[] } | null;
}) {
  const [valores, setValores] = useState(() => Object.fromEntries(filas.map((f) => [f.id, f])));
  const [caja, setCaja] = useState(cajaId ?? cajas[0]?.id ?? "");
  const [feriados, setFeriados] = useState<string[]>(feriadosIniciales);
  const [feriadosMes, setFeriadosMes] = useState<string[]>(bonos?.feriadosIniciales ?? []);
  const [abiertos, setAbiertos] = useState<string[]>([]);
  const fechas = fechasDe(semana.desde, semana.hasta);
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
  /**
   * Se manda a mano y no con `<form action>`: con `action`, React reinicia el formulario después de
   * guardar, y los tildes y las opciones vuelven a como estaban al abrir la página aunque en
   * pantalla se vea lo elegido. El feriado, que es un casillero escondido, quedaba marcado debajo
   * del botón apagado y el siguiente «Guardar» lo volvía a poner; lo mismo los bonos y la caja.
   */
  const enviar = (e: React.FormEvent<HTMLFormElement>) => {
    unaVez(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    const datos = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(datos));
  };

  const cambiar = (id: string, campo: Campo, valor: string) =>
    setValores((v) => ({ ...v, [id]: { ...v[id], [campo]: valor } }));
  const marcar = (id: string, bono: "presentismo" | "puntualidad", valor: boolean) =>
    setValores((v) => ({ ...v, [id]: { ...v[id], [bono]: valor } }));
  /** Corregir la entrada o la salida de un día; `undefined` vuelve a lo que dicen las marcas. */
  const corregirDia = (id: string, fecha: string, cambios: Partial<Pick<DiaFichero, "entrada" | "salida">> | "volver") =>
    setValores((v) => ({
      ...v,
      [id]: {
        ...v[id],
        dias: (v[id].dias ?? []).map((d) => {
          if (d.fecha !== fecha) return d;
          if (cambios === "volver") return { fecha: d.fecha, marcas: d.marcas, ...(d.arrastre ? { arrastre: true } : {}) };
          return { ...d, ...cambios };
        }),
      },
    }));

  const semanal = forma === "SEMANAL";
  const conBonos = semanal && Boolean(bonos);
  const cuentas = filas.map((f) => {
    const v = valores[f.id];
    // Con los días del fichero, las horas salen de ahí; si no, de lo que se escribió.
    const resumen = semanal && v.dias ? resumenDeSemana(v.dias, reglas, { ...semana, feriados }) : null;
    // Los bonos, con el fichero del mes: lo que sugiere para cada casilla.
    const delMes =
      bonos && f.diasDelMes
        ? resumenDeSemana(f.diasDelMes, reglas, { desde: bonos.desde, hasta: bonos.hasta, feriados: feriadosMes })
        : null;
    const cuenta = f.tarifa
      ? cuentaDelRenglon({
          forma,
          tarifa: D(f.tarifa),
          horas: resumen ? D(String(resumen.horas)) : (leer(v.horas) ?? D("0")),
          horasFeriado: resumen ? D(String(resumen.horasFeriado)) : (leer(v.feriado) ?? D("0")),
          presentismo: conBonos && v.presentismo,
          puntualidad: conBonos && v.puntualidad,
          monotributo: leer(v.monotributo) ?? D("0"),
          saldoAnterior: D(f.saldoAnterior),
          descuentoACuenta: leer(v.acuenta),
          pagado: leer(v.pagado),
        })
      : null;
    return { f, v, cuenta, resumen, delMes };
  });
  const suma = (pick: (c: NonNullable<(typeof cuentas)[number]["cuenta"]>) => Prisma.Decimal) =>
    cuentas.reduce((acc, { cuenta }) => (cuenta ? acc.plus(pick(cuenta)) : acc), D("0"));
  const totalSueldo = suma((c) => c.sueldo);
  const totalEfectivo = suma((c) => c.pagado);
  const totalHoras = cuentas.reduce((acc, { v, resumen }) => acc.plus(resumen ? resumen.horas : (leer(v.horas) ?? 0)), D("0"));
  const conACuenta = cuentas.some(({ cuenta, v }) => cuenta?.aCuenta.greaterThan(0) || cuenta?.deudaAnterior.greaterThan(0) || v.acuenta);
  const nombreCaja = cajas.find((c) => c.id === caja)?.name ?? "la caja";
  const columnas = (semanal ? 7 : 6) + (conBonos ? 2 : 0) + (conACuenta ? 1 : 0);
  const pendientes = cuentas.reduce((acc, { resumen }) => acc + (resumen?.pendientes.length ?? 0), 0);
  const conDatos = cuentas.filter(({ cuenta }) => cuenta && (cuenta.gasto.greaterThan(0) || cuenta.pagado.greaterThan(0))).length;

  return (
    <form onSubmit={enviar} className="space-y-4">
      <input type="hidden" name="planillaId" value={planillaId} />

      {semanal && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-foreground/60">Feriados de la semana:</span>
          {fechas.map((fecha) => {
            const activo = feriados.includes(fecha);
            return (
              <label
                key={fecha}
                className={`cursor-pointer rounded-md border px-2 py-1 text-xs tabular-nums transition-colors ${
                  activo ? "border-primary bg-primary font-medium text-primary-foreground" : "border-foreground/15 text-foreground/60 hover:bg-foreground/5"
                }`}
              >
                <input
                  type="checkbox"
                  name="feriado_fecha"
                  value={fecha}
                  checked={activo}
                  onChange={(e) => setFeriados((fs) => (e.target.checked ? [...fs, fecha] : fs.filter((x) => x !== fecha)))}
                  disabled={!puedeEditar}
                  className="sr-only"
                />
                {DIAS_SEMANA[diaDeLaSemana(fecha)]} {Number(fecha.slice(8))}
              </label>
            );
          })}
          <span className="text-xs text-foreground/40">Sus horas van al valor hora + 0,5.</span>
        </div>
      )}

      {conBonos && bonos && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-foreground/60">Feriados de {bonos.nombre}:</span>
          {fechasDe(bonos.desde, bonos.hasta)
            .filter((fecha) => {
              const d = diaDeLaSemana(fecha);
              return d >= 1 && d <= 5;
            })
            .map((fecha) => {
              const activo = feriadosMes.includes(fecha);
              return (
                <label
                  key={fecha}
                  className={`cursor-pointer rounded-md border px-2 py-1 text-xs tabular-nums transition-colors ${
                    activo ? "border-primary bg-primary font-medium text-primary-foreground" : "border-foreground/15 text-foreground/60 hover:bg-foreground/5"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="feriado_mes"
                    value={fecha}
                    checked={activo}
                    onChange={(e) => setFeriadosMes((fs) => (e.target.checked ? [...fs, fecha] : fs.filter((x) => x !== fecha)))}
                    disabled={!puedeEditar}
                    className="sr-only"
                  />
                  {DIAS_SEMANA[diaDeLaSemana(fecha)]} {Number(fecha.slice(8))}
                </label>
              );
            })}
          <span className="text-xs text-foreground/40">No cuentan para el presentismo del mes.</span>
        </div>
      )}

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
              {conBonos && (
                <th className={`${celda} text-center`} title={`Bono de un jornal por el presentismo de ${bonos!.nombre}.`}>
                  Presentismo {bonos!.nombre}
                </th>
              )}
              {conBonos && (
                <th className={`${celda} text-center`} title={`Bono de un jornal por la puntualidad de ${bonos!.nombre}.`}>
                  Puntualidad {bonos!.nombre}
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
            {cuentas.map(({ f, v, cuenta, resumen, delMes }) => (
              <Fragment key={f.id}>
              <tr className="align-top">
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
                {semanal && resumen && (
                  <td className={`${celda} text-right`}>
                    <input type="hidden" name={`dias_${f.id}`} value={JSON.stringify(v.dias)} />
                    <p className="pt-2 font-medium tabular-nums">{horasYMinutos(resumen.horas)}</p>
                    <button
                      type="button"
                      onClick={() => setAbiertos((a) => (a.includes(f.id) ? a.filter((x) => x !== f.id) : [...a, f.id]))}
                      className="whitespace-nowrap text-[11px] text-foreground/50 underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {abiertos.includes(f.id) ? "ocultar días" : "ver días"}
                    </button>
                    {resumen.pendientes.length > 0 && (
                      <p className="whitespace-nowrap text-[11px] text-amber-700 dark:text-amber-400">
                        {resumen.pendientes.length} sin marca
                      </p>
                    )}
                  </td>
                )}
                {semanal && resumen && (
                  <td className={importe}>{resumen.horasFeriado ? horasYMinutos(resumen.horasFeriado) : ""}</td>
                )}
                {semanal && !resumen && (
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
                {semanal && !resumen && (
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
                {conBonos &&
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
                      {!delMes && (
                        <p className="mx-auto mt-0.5 max-w-[9rem] text-[10px] leading-tight text-foreground/40">sin fichero del mes</p>
                      )}
                      {delMes &&
                        (() => {
                          const sugerido = bono === "presentismo" ? delMes.presentismo : delMes.puntualidad;
                          const motivos =
                            bono === "presentismo"
                              ? delMes.sinPresentismo
                              : delMes.sinPresentismo.length
                                ? ["sin presentismo"]
                                : delMes.sinPuntualidad;
                          return (
                            <p
                              title={motivos.join("; ")}
                              className={`mx-auto mt-0.5 max-w-[9rem] text-[10px] leading-tight ${
                                sugerido !== v[bono] ? "text-amber-700 dark:text-amber-400" : "text-foreground/40"
                              }`}
                            >
                              {sugerido ? "sugerido: sí" : (motivos[0] ?? "sugerido: no")}
                            </p>
                          );
                        })()}
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
              {semanal && resumen && v.dias && abiertos.includes(f.id) && (
                <tr className="bg-foreground/[0.02]">
                  <td colSpan={columnas} className="px-2 pb-3 pt-1">
                    {resumen.arrastre > 0 && (
                      <p className="mb-1 text-xs text-foreground/60">
                        + {horasYMinutos(resumen.arrastre)} del viernes anterior, después de las {reglas.corteViernes}.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                      {resumen.dias.map((c) => {
                        const d = v.dias!.find((x) => x.fecha === c.fecha) ?? { fecha: c.fecha, marcas: [] };
                        const marcas = limpiarMarcas(d.marcas);
                        const pendiente = c.estado !== "ok" && c.estado !== "ausente";
                        const valorDe = (campo: "entrada" | "salida") =>
                          d[campo] !== undefined ? (d[campo] ?? "") : campo === "entrada" ? (marcas[0] ?? "") : marcas.length >= 2 ? marcas[marcas.length - 1] : "";
                        return (
                          <div
                            key={c.fecha}
                            className={`rounded-lg border p-2 text-xs ${
                              pendiente ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : "border-foreground/10 bg-background"
                            }`}
                          >
                            <p className="font-medium">
                              {DIAS_SEMANA[c.diaSemana]} {Number(c.fecha.slice(8))}
                              {c.feriado ? " · feriado" : ""}
                            </p>
                            <p className="truncate text-[11px] text-foreground/50" title={marcas.join(" · ")}>
                              {marcas.length ? marcas.join(" · ") : "sin marcas"}
                            </p>
                            <div className="mt-1 grid grid-cols-2 gap-1">
                              {(["entrada", "salida"] as const).map((campo) => (
                                <input
                                  key={campo}
                                  value={valorDe(campo)}
                                  onChange={(e) => corregirDia(f.id, c.fecha, { [campo]: e.target.value.trim() ? e.target.value : null })}
                                  disabled={!puedeEditar}
                                  placeholder={campo === "salida" && c.diaSemana === 5 ? reglas.corteViernes : "--:--"}
                                  aria-label={`${campo === "entrada" ? "Entrada" : "Salida"} de ${f.nombre} el ${c.fecha}`}
                                  className={entradaHora}
                                />
                              ))}
                            </div>
                            <p className={`mt-1 tabular-nums ${pendiente ? "font-medium text-amber-700 dark:text-amber-400" : "text-foreground/70"}`}>
                              {c.estado === "ausente"
                                ? c.habil && !c.feriado
                                  ? "no vino"
                                  : "—"
                                : c.estado === "falta-salida"
                                  ? "falta la salida"
                                  : c.estado === "falta-entrada"
                                    ? "falta la entrada"
                                    : c.estado === "error"
                                      ? "salida antes que entrada"
                                      : `${horasYMinutos(c.horas ?? 0)}${c.almuerzo ? " (−almuerzo)" : ""}${c.salidaPorCorte ? " · hasta el corte" : ""}`}
                              {c.tarde && " · tarde"}
                            </p>
                            {c.editado && puedeEditar && (
                              <button
                                type="button"
                                onClick={() => corregirDia(f.id, c.fecha, "volver")}
                                className="text-[11px] text-foreground/50 underline-offset-2 hover:underline"
                              >
                                volver a las marcas
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-foreground/15 font-semibold tabular-nums">
            <tr>
              <td className={celda}>Total</td>
              {semanal && <td className={`${celda} text-right`}>{totalHoras.toString().replace(".", ",")}</td>}
              {semanal && <td />}
              {conBonos && <td />}
              {conBonos && <td />}
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
          ? `Horas al valor hora (jornal ÷ 8); las de feriado, que van dentro de las horas, al valor hora más 0,5.${conBonos ? ` Presentismo y puntualidad de ${bonos!.nombre} suman un jornal cada uno.` : ""} `
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
          {pendientes > 0 && (
            <li className="text-amber-700 dark:text-amber-400">
              Hay {pendientes} {pendientes === 1 ? "día" : "días"} con una marca de menos: se cuentan en cero hasta que se completen.
            </li>
          )}
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
