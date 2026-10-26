/**
 * Las horas de la semana a partir de las marcas del fichero, con las reglas del arreglo con los
 * chicos. Es la misma cuenta en el navegador —donde Adriana corrige un día que no se fichó— y en el
 * servidor, que la vuelve a hacer al guardar.
 *
 * Las reglas salieron de reproducir lo que Adriana venía cargando a mano (semana del 17 al 23/10:
 * mismas horas y mismos bonos), y se pueden cambiar desde Sueldos → Reglas del fichero:
 * - un día son las horas de la primera a la última marca;
 * - los días de semana completos se descuenta el almuerzo (1 h), que no se ficha. El sábado —que
 *   algunos vienen a limpiar y ordenar— y los días cortos, no;
 * - el viernes se cuenta hasta las 19, que es cuando se va Adriana con la planilla hecha. Lo que se
 *   queden después pasa a la semana siguiente;
 * - el total se redondea a la media hora;
 * - presentismo: todos los días hábiles de la semana con 8 horas o más (los feriados no cuentan);
 * - puntualidad: todos los días hábiles con entrada antes de las 8, y además el presentismo.
 *
 * Usa sólo las marcas crudas: el horario que tiene cargado el reloj (de 9 a 18, sin nadie asignado)
 * y los días de la semana que muestra (al sábado le dice viernes) están mal, y no se miran.
 */

export type ReglasFichero = {
  /** Hasta qué hora es llegar a tiempo, "08:00". */
  entradaPuntual: string;
  /** Hasta qué hora se cuenta el viernes, "19:00". */
  corteViernes: string;
  almuerzoMinutos: number;
  /** Desde cuántas horas de puerta a puerta un día lleva descuento de almuerzo. */
  diaConAlmuerzoHoras: number;
  /** Cuántas horas trabajadas (ya sin almuerzo) hacen que el día cuente para el presentismo. */
  presentismoHoras: number;
  /** A cuánto se redondea el total de la semana, en horas: 0,5 es a la media hora. */
  redondeoHoras: number;
};

export const REGLAS_POR_DEFECTO: ReglasFichero = {
  entradaPuntual: "08:00",
  corteViernes: "19:00",
  almuerzoMinutos: 60,
  diaConAlmuerzoHoras: 6,
  presentismoHoras: 8,
  redondeoHoras: 0.5,
};

/** Un día de un empleado, como se guarda en la planilla. `entrada` y `salida` son correcciones a mano. */
export type DiaFichero = {
  fecha: string; // "2026-10-19"
  marcas: string[]; // ["07:32", "18:46"]
  entrada?: string | null;
  salida?: string | null;
  /** El viernes anterior a la semana: sólo cuenta lo que se quedaron después del corte. */
  arrastre?: boolean;
};

export type EstadoDelDia = "ok" | "ausente" | "falta-entrada" | "falta-salida" | "error";

export type CuentaDelDia = {
  fecha: string;
  diaSemana: number; // 0 domingo … 6 sábado
  habil: boolean;
  feriado: boolean;
  estado: EstadoDelDia;
  entrada: string | null;
  /** La salida que se usó: el viernes, como mucho el corte. */
  salida: string | null;
  /** El viernes sin marca de salida se cuenta hasta el corte. */
  salidaPorCorte: boolean;
  almuerzo: boolean;
  /** Horas que cuentan esta semana; null si falta una marca y no se puede saber. */
  horas: number | null;
  /** Lo que se quedó el viernes después del corte: pasa a la semana siguiente. */
  extraViernes: number;
  /** 8 horas o más: cuenta para el presentismo. */
  completo: boolean;
  tarde: boolean;
  editado: boolean;
};

export const DIAS_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

const aMinutos = (h: string) => {
  const [a, b] = h.split(":").map(Number);
  return a * 60 + b;
};
const aHora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const esHora = (h: string) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(h.trim());
const normalizarHora = (h: string) => aHora(aMinutos(h.trim()));

/** Las marcas en orden, sin las repetidas: los que fichan dos veces seguidas dejan dos marcas iguales. */
export function limpiarMarcas(marcas: string[]): string[] {
  const ordenadas = [...new Set(marcas.filter(esHora).map(normalizarHora))].sort();
  const limpias: string[] = [];
  for (const m of ordenadas) {
    const ultima = limpias.at(-1);
    if (ultima && aMinutos(m) - aMinutos(ultima) <= 3) continue;
    limpias.push(m);
  }
  return limpias;
}

export function diaDeLaSemana(fecha: string) {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}

export function calcularDia(d: DiaFichero, reglas: ReglasFichero, feriado: boolean): CuentaDelDia {
  const diaSemana = diaDeLaSemana(d.fecha);
  const habil = diaSemana >= 1 && diaSemana <= 5;
  const viernes = diaSemana === 5;
  const marcas = limpiarMarcas(d.marcas);
  const editado = d.entrada !== undefined || d.salida !== undefined;
  const entrada = d.entrada !== undefined ? d.entrada : (marcas[0] ?? null);
  const salidaReal = d.salida !== undefined ? d.salida : marcas.length >= 2 ? marcas[marcas.length - 1] : null;
  const corte = aMinutos(reglas.corteViernes);
  const base = { fecha: d.fecha, diaSemana, habil, feriado, editado, almuerzo: false, extraViernes: 0, completo: false, tarde: false, salidaPorCorte: false };

  if (d.arrastre) {
    const extra = salidaReal && aMinutos(salidaReal) > corte ? (aMinutos(salidaReal) - corte) / 60 : 0;
    return { ...base, estado: "ok", entrada: reglas.corteViernes, salida: salidaReal, horas: extra };
  }
  if (!entrada && !salidaReal) return { ...base, estado: "ausente", entrada: null, salida: null, horas: 0 };
  if (!entrada) return { ...base, estado: "falta-entrada", entrada: null, salida: salidaReal, horas: null };

  let salida = salidaReal;
  let salidaPorCorte = false;
  let extraViernes = 0;
  if (viernes) {
    if (!salida) {
      salida = reglas.corteViernes;
      salidaPorCorte = true;
    } else if (aMinutos(salida) > corte) {
      extraViernes = (aMinutos(salida) - corte) / 60;
      salida = reglas.corteViernes;
    }
  }
  if (!salida) return { ...base, estado: "falta-salida", entrada, salida: null, horas: null };

  const span = aMinutos(salida) - aMinutos(entrada);
  if (span <= 0) return { ...base, estado: "error", entrada, salida, horas: null };
  const almuerzo = habil && span >= reglas.diaConAlmuerzoHoras * 60;
  const neto = span - (almuerzo ? reglas.almuerzoMinutos : 0);
  return {
    ...base,
    estado: "ok",
    entrada,
    salida,
    salidaPorCorte,
    almuerzo,
    horas: neto / 60,
    extraViernes,
    completo: neto >= reglas.presentismoHoras * 60,
    tarde: habil && aMinutos(entrada) > aMinutos(reglas.entradaPuntual),
  };
}

/** Las fechas de la semana, de `desde` a `hasta` inclusive, como "2026-10-19". */
export function fechasDe(desde: string, hasta: string): string[] {
  const fechas: string[] = [];
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hasta}T00:00:00Z`); t += 86_400_000) {
    fechas.push(new Date(t).toISOString().slice(0, 10));
  }
  return fechas;
}

export function redondear(horas: number, a: number) {
  if (!a) return Math.round(horas * 100) / 100;
  return Math.round(horas / a) * a;
}

export type ResumenDeSemana = {
  dias: CuentaDelDia[];
  /** Las horas después del corte del viernes anterior, que se suman a esta semana. */
  arrastre: number;
  horasExactas: number;
  horas: number;
  horasFeriado: number;
  presentismo: boolean;
  puntualidad: boolean;
  /** Por qué no, en palabras: "faltó el lunes 19", "8:25 el miércoles 21". */
  sinPresentismo: string[];
  sinPuntualidad: string[];
  /** Días a los que les falta una marca: hay que mirar las cámaras. */
  pendientes: string[];
};

const nombreDelDia = (c: CuentaDelDia) => `${DIAS_SEMANA[c.diaSemana]} ${Number(c.fecha.slice(8))}`;

export function resumenDeSemana(
  dias: DiaFichero[],
  reglas: ReglasFichero,
  semana: { desde: string; hasta: string; feriados: string[] }
): ResumenDeSemana {
  const feriados = new Set(semana.feriados);
  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  const cuentas = fechasDe(semana.desde, semana.hasta).map((fecha) =>
    calcularDia(porFecha.get(fecha) ?? { fecha, marcas: [] }, reglas, feriados.has(fecha))
  );
  const arrastre = dias
    .filter((d) => d.arrastre)
    .reduce((acc, d) => acc + (calcularDia(d, reglas, false).horas ?? 0), 0);

  const horasExactas = cuentas.reduce((acc, c) => acc + (c.horas ?? 0), 0) + arrastre;
  const horasFeriadoExactas = cuentas.filter((c) => c.feriado).reduce((acc, c) => acc + (c.horas ?? 0), 0);

  const sinPresentismo: string[] = [];
  const sinPuntualidad: string[] = [];
  const pendientes: string[] = [];
  for (const c of cuentas) {
    if (c.estado === "falta-salida" || c.estado === "falta-entrada" || c.estado === "error") {
      pendientes.push(`${nombreDelDia(c)}: ${c.estado === "falta-salida" ? "falta la salida" : c.estado === "falta-entrada" ? "falta la entrada" : "la salida es antes que la entrada"}`);
    }
    if (!c.habil || c.feriado) continue;
    if (c.estado === "ausente") sinPresentismo.push(`faltó el ${nombreDelDia(c)}`);
    else if (c.estado === "ok" && !c.completo) sinPresentismo.push(`${(c.horas ?? 0).toFixed(1).replace(".", ",")} h el ${nombreDelDia(c)}`);
    else if (c.estado !== "ok") sinPresentismo.push(`no se sabe el ${nombreDelDia(c)} (falta una marca)`);
    if (c.tarde) sinPuntualidad.push(`entró ${c.entrada} el ${nombreDelDia(c)}`);
  }

  return {
    dias: cuentas,
    arrastre,
    horasExactas,
    horas: redondear(horasExactas, reglas.redondeoHoras),
    horasFeriado: redondear(horasFeriadoExactas, reglas.redondeoHoras),
    presentismo: sinPresentismo.length === 0,
    // Sin presentismo no hay puntualidad: el que faltó no la cobra aunque los otros días llegara a
    // tiempo (así se pagó a Elías, Ezequiel y Melani la semana del 17/10).
    puntualidad: sinPresentismo.length === 0 && sinPuntualidad.length === 0,
    sinPresentismo,
    sinPuntualidad,
    pendientes,
  };
}

/** Lee las reglas guardadas, completando con las de por defecto lo que falte. */
export function leerReglas(json: string | null | undefined): ReglasFichero {
  try {
    return { ...REGLAS_POR_DEFECTO, ...(json ? (JSON.parse(json) as Partial<ReglasFichero>) : {}) };
  } catch {
    return REGLAS_POR_DEFECTO;
  }
}
