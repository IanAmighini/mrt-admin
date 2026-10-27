/**
 * La exportación del reloj de fichar ("AllReport.xls"), hoja "Attendance Record": una fila por
 * empleado y una columna por día, con todas las marcas de ese día en la misma celda (una por
 * renglón). Esto la lee ya convertida a filas; abrir el .xls lo hace `fichero-xls`.
 *
 * Del archivo sólo se usan las marcas. El resto lo calcula mal el propio reloj —tiene un horario de
 * 9 a 18 que no es el real y nadie asignado, y al sábado le dice viernes— y por eso no se mira.
 */

export type EmpleadoDelFichero = {
  /** El número en el reloj ("1004"). Vacío si en el reloj está mal cargado (Melani: el nombre en el lugar del número). */
  id: string;
  nombre: string;
  /** Por fecha ("2026-10-19"), las marcas de ese día ("07:32"). */
  marcas: Record<string, string[]>;
};

export type ExportacionDelFichero = {
  desde: string;
  hasta: string;
  /** El día en que se bajó ("Create Time"): un mes bajado antes de terminar trae los últimos días vacíos. */
  creado: string | null;
  empleados: EmpleadoDelFichero[];
};

type Celda = string | number | null | undefined;

const texto = (c: Celda) => (c === null || c === undefined ? "" : String(c)).trim();
const sumarDias = (fecha: string, dias: number) =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

export function leerAttendanceRecord(filas: Celda[][]): ExportacionDelFichero {
  const rango = filas
    .map((f) => texto(f[0]))
    .map((t) => t.match(/(\d{4})\/(\d{2})\/(\d{2})\s*-\s*(\d{4})\/(\d{2})\/(\d{2})/))
    .find(Boolean);
  if (!rango) throw new Error('No encontré el período ("Made Date") en la hoja Attendance Record.');
  const desde = `${rango[1]}-${rango[2]}-${rango[3]}`;
  const hasta = `${rango[4]}-${rango[5]}-${rango[6]}`;
  const creadoEn = filas
    .map((f) => texto(f[0]).match(/Create Time:\s*(\d{4})\/(\d{2})\/(\d{2})/))
    .find(Boolean);
  const creado = creadoEn ? `${creadoEn[1]}-${creadoEn[2]}-${creadoEn[3]}` : null;

  const encabezado = filas.findIndex((f) => /employee id/i.test(texto(f[0])));
  if (encabezado < 0) throw new Error('No encontré el encabezado ("Employee ID") en la hoja Attendance Record.');
  // Las columnas de días arrancan en la cuarta y van seguidas desde `desde`: la 4ª es el primer día.
  const columnas = filas[encabezado].slice(3).map(texto);
  const fechas = columnas.map((dia, i) => {
    const fecha = sumarDias(desde, i);
    if (dia && Number(dia) !== Number(fecha.slice(8))) {
      throw new Error(`Las columnas de días no coinciden con el período: la columna "${dia}" tendría que ser el ${fecha}.`);
    }
    return dia ? fecha : null;
  });

  const empleados: EmpleadoDelFichero[] = [];
  for (const fila of filas.slice(encabezado + 1)) {
    const primera = texto(fila[0]);
    const segunda = texto(fila[1]);
    if (!primera && !segunda) continue;
    // Una fila con el nombre en la columna del número (Melani): se toma como nombre, sin número.
    const numerico = /^\d+$/.test(primera);
    const id = numerico ? primera : "";
    const nombre = segunda || (numerico ? "" : primera);
    if (!nombre && !id) continue;
    const marcas: Record<string, string[]> = {};
    fila.slice(3).forEach((celda, i) => {
      const fecha = fechas[i];
      if (!fecha) return;
      const delDia = texto(celda)
        .split(/\r?\n/)
        .map((m) => m.trim())
        .filter((m) => /^\d{1,2}:\d{2}$/.test(m));
      if (delDia.length) marcas[fecha] = delDia;
    });
    empleados.push({ id, nombre, marcas });
  }
  return { desde, hasta, creado, empleados };
}

/** "Lucrecia Iznardo" → "lucrecia": para comparar con el nombre que tiene en la app. */
const primerNombre = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)[0] ?? "";

/**
 * Quién es quién: primero por el número del reloj guardado en la ficha del empleado; si todavía no
 * lo tiene, por el primer nombre. Si hay dos con el mismo nombre (Matías Carro, que ya no está, y
 * Matías Suárez) se queda con el que fichó esa semana; si sigue habiendo dos, no adivina.
 */
export function emparejar<E extends { id: string; name: string; idFichero: string | null }>(
  empleados: E[],
  fichero: EmpleadoDelFichero[],
  fechasDeLaSemana: string[]
): { pares: { empleado: E; delFichero: EmpleadoDelFichero; nuevo: boolean }[]; sinMarcas: E[]; ambiguos: E[] } {
  const fichoEnLaSemana = (f: EmpleadoDelFichero) => fechasDeLaSemana.some((d) => f.marcas[d]?.length);
  const pares: { empleado: E; delFichero: EmpleadoDelFichero; nuevo: boolean }[] = [];
  const sinMarcas: E[] = [];
  const ambiguos: E[] = [];
  for (const e of empleados) {
    const porNumero = e.idFichero ? fichero.find((f) => f.id && f.id === e.idFichero) : undefined;
    if (porNumero) {
      pares.push({ empleado: e, delFichero: porNumero, nuevo: false });
      continue;
    }
    let candidatos = fichero.filter((f) => primerNombre(f.nombre) === primerNombre(e.name));
    if (candidatos.length > 1) candidatos = candidatos.filter(fichoEnLaSemana);
    if (candidatos.length === 1) pares.push({ empleado: e, delFichero: candidatos[0], nuevo: true });
    else if (candidatos.length > 1) ambiguos.push(e);
    else sinMarcas.push(e);
  }
  return { pares, sinMarcas, ambiguos };
}
