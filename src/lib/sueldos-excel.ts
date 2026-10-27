import "server-only";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { formatFecha } from "@/lib/period";
import { valorHora, RECARGO_FERIADO } from "@/lib/sueldos-calculo";
import { bonosDelRenglon, getRenglonesCalculados, nombreDePlanilla } from "@/lib/sueldos";
import { nombreDelMes } from "@/lib/fichero-calculo";

type Planilla = NonNullable<Awaited<ReturnType<typeof getRenglonesCalculados>>>;

const AMARILLO = "FFFFD966";
const FINO: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF000000" } };
const GRUESO: Partial<ExcelJS.Border> = { style: "medium", color: { argb: "FF000000" } };
const BORDES = { top: FINO, left: FINO, bottom: FINO, right: FINO };
const RECUADRO = { top: GRUESO, left: GRUESO, bottom: GRUESO, right: GRUESO };

const MILES = "#,##0";
const CON_DECIMALES = "#,##0.00";
const PESOS = '"$"#,##0';
const PESOS_CON_DECIMALES = '"$"#,##0.00';

const n = (v: Prisma.Decimal | null | undefined) => (v ? v.toNumber() : 0);
/** Una fórmula con su resultado ya calculado: Excel la recalcula, y el que la abre en una vista
 * previa (el celular, el mail) igual ve el número. */
const f = (formula: string, result: number) => ({ formula, result });

/**
 * La planilla en Excel, con el formato de la que armaba Adriana a mano: título de la semana,
 * encabezado amarillo, una fila por empleado y, abajo, la cuenta del feriado. Va con fórmulas —el
 * valor hora es el jornal ÷ 8, el sueldo es horas × valor hora más el feriado, más los bonos de
 * presentismo y puntualidad (un jornal cada uno), menos los adelantos— así se puede retocar ahí
 * mismo como antes. Los totales suman todas las filas.
 */
export async function planillaEnExcel(planillaId: string): Promise<{ archivo: Uint8Array; nombre: string } | null> {
  const datos = await getRenglonesCalculados(planillaId);
  if (!datos) return null;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MRT";
  wb.created = new Date();
  const ws = wb.addWorksheet(datos.planilla.forma === "SEMANAL" ? "Semana" : "Mes");
  if (datos.planilla.forma === "SEMANAL") semanal(ws, datos);
  else mensual(ws, datos);
  ws.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const buffer = await wb.xlsx.writeBuffer();
  const [dia, mes] = formatFecha(datos.planilla.desde).split("/");
  const [diaH, mesH] = formatFecha(datos.planilla.hasta).split("/");
  const nombre =
    datos.planilla.forma === "SEMANAL"
      ? `Sueldos semana ${dia}-${mes} al ${diaH}-${mesH}.xlsx`
      : `Sueldos ${nombreDePlanilla(datos.planilla).replace("Sueldos de ", "")}.xlsx`;
  return { archivo: new Uint8Array(buffer as ArrayBuffer), nombre };
}

function titulo(ws: ExcelJS.Worksheet, texto: string, columnas: number) {
  ws.mergeCells(1, 1, 1, columnas);
  const c = ws.getCell(1, 1);
  c.value = texto;
  c.alignment = { horizontal: "center", vertical: "middle" };
  c.font = { size: 12 };
  c.border = BORDES;
  ws.getRow(1).height = 22;
}

function encabezado(ws: ExcelJS.Worksheet, fila: number, textos: string[], negritas: number[] = []) {
  textos.forEach((t, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = t;
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMARILLO } };
    c.font = { size: 12, bold: negritas.includes(i + 1) };
    c.border = BORDES;
    c.alignment = { vertical: "middle", horizontal: i >= 2 && i < textos.length - 1 ? "center" : "left", wrapText: true };
  });
  ws.getRow(fila).height = 22;
}

/** Lo que se le descontó: lo que tenía a cuenta. Si se le debía de antes, suma (va en negativo). */
const adelantosDe = (c: Planilla["renglones"][number]["cuenta"]) =>
  c ? c.descuentoACuenta.minus(c.deudaAnterior).toNumber() : 0;

function semanal(ws: ExcelJS.Worksheet, { planilla, renglones }: Planilla) {
  // A Usuario · B Nombre · C Jornal · D Valor hora · E Horas · F Presentismo · G Puntualidad ·
  // H Adelantos · I Sueldo · J Redondeo · K Comentarios
  ws.columns = [
    { width: 9 },
    { width: 24 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 15 },
    { width: 15 },
    { width: 40 },
  ];
  titulo(ws, nombreDePlanilla(planilla).toUpperCase(), 11);
  encabezado(
    ws,
    2,
    [
      "Usuario",
      "Nombre y Apellido",
      "Valor Jornal",
      "Valor hora",
      "Total horas",
      // Los bonos son del mes que paga esta semana: el encabezado dice cuál.
      planilla.bonosDe ? `Presentismo ${nombreDelMes(planilla.bonosDe)}` : "Presentismo",
      planilla.bonosDe ? `Puntualidad ${nombreDelMes(planilla.bonosDe)}` : "Puntualidad",
      "Adelantos",
      "Sueldo",
      "Redondeo",
      "Comentarios",
    ],
    [9, 10]
  );

  const primera = 3;
  const ultima = primera + renglones.length - 1;
  const totales = ultima + 1;
  // La tabla del feriado va abajo, como en la planilla: dos filas de aire, el encabezado y los renglones.
  const encabezadoFeriado = totales + 3;
  const primeraFeriado = encabezadoFeriado + 1;

  renglones.forEach(({ r, tarifa, cuenta }, i) => {
    const fila = primera + i;
    const filaFeriado = primeraFeriado + i;
    const jornal = n(tarifa);
    const hora = tarifa ? valorHora(tarifa).toNumber() : 0;
    const adelantos = adelantosDe(cuenta);
    const feriado = n(r.horasFeriado) * hora * RECARGO_FERIADO.toNumber();
    const bono = (si: boolean) => (si ? f(`C${fila}`, jornal) : 0);
    const { presentismo, puntualidad } = bonosDelRenglon(planilla, r);

    const valores: [string, ExcelJS.CellValue, string?][] = [
      ["A", null],
      ["B", r.entity.name],
      ["C", jornal, MILES],
      ["D", f(`C${fila}/8`, hora), CON_DECIMALES],
      ["E", n(r.horas), "#,##0.##"],
      // Un jornal cada uno, si se lo ganó en el mes de los bonos.
      ["F", bono(presentismo), PESOS],
      ["G", bono(puntualidad), PESOS],
      ["H", adelantos ? adelantos : null, PESOS],
      [
        "I",
        f(
          `D${fila}*E${fila}+G${filaFeriado}+F${fila}+G${fila}-H${fila}`,
          n(r.horas) * hora + feriado + (presentismo ? jornal : 0) + (puntualidad ? jornal : 0) - adelantos
        ),
        PESOS,
      ],
      ["J", cuenta ? cuenta.pagado.toNumber() : null, PESOS],
      ["K", r.comentario || null],
    ];
    for (const [col, valor, formato] of valores) {
      const c = ws.getCell(`${col}${fila}`);
      c.value = valor;
      c.border = BORDES;
      if (formato) c.numFmt = formato;
      if (col === "C" || col === "D") c.alignment = { horizontal: "right" };
      if (col === "E") c.alignment = { horizontal: "center" };
    }
    ws.getRow(fila).height = 20;
  });

  const sumaDe = (pick: (c: NonNullable<Planilla["renglones"][number]["cuenta"]>) => number) =>
    renglones.reduce((a, { cuenta }) => a + (cuenta ? pick(cuenta) : 0), 0);
  const totalAdelantos = renglones.reduce((a, { cuenta }) => a + adelantosDe(cuenta), 0);
  const totalSueldo = sumaDe((c) => c.aPagar.toNumber());
  const totalRedondeo = sumaDe((c) => c.pagado.toNumber());
  const rango = (col: string) => `${col}${primera}:${col}${ultima}`;
  ws.getCell(`G${totales}`).value = "Total";
  ws.getCell(`G${totales}`).alignment = { horizontal: "center" };
  ws.getCell(`H${totales}`).value = f(`SUM(${rango("H")})`, totalAdelantos);
  ws.getCell(`I${totales}`).value = f(`SUM(${rango("I")})`, totalSueldo);
  ws.getCell(`J${totales}`).value = f(`SUM(${rango("J")})`, totalRedondeo);
  for (const col of ["G", "H", "I", "J"]) {
    const c = ws.getCell(`${col}${totales}`);
    c.border = RECUADRO;
    c.font = { size: 12 };
    if (col !== "G") {
      c.numFmt = PESOS;
      c.alignment = { horizontal: "center" };
    }
  }
  // Lo que costó la semana: lo pagado ahora más lo que ya había cobrado a cuenta.
  const costo = ws.getCell(`H${totales + 1}`);
  costo.value = f(`H${totales}+I${totales}`, totalAdelantos + totalSueldo);
  costo.numFmt = PESOS;
  costo.border = RECUADRO;
  costo.alignment = { horizontal: "center" };

  // El feriado: las horas en feriado van al valor hora más 0,5; acá va ese medio extra.
  const titulosFeriado: [string, string][] = [
    ["B", "Nombre"],
    ["C", "Jornal"],
    ["D", "Valor hora"],
    ["E", "Horas feriado"],
    ["F", "Factor 0,5"],
    ["G", "Total"],
  ];
  for (const [col, texto] of titulosFeriado) {
    const c = ws.getCell(`${col}${encabezadoFeriado}`);
    c.value = texto;
    c.font = { bold: col !== "G" };
    c.border = { bottom: FINO };
    c.alignment = { horizontal: col === "B" || col === "C" || col === "D" || col === "G" ? "left" : "center" };
  }
  renglones.forEach(({ r, tarifa }, i) => {
    const fila = primeraFeriado + i;
    const hora = tarifa ? valorHora(tarifa).toNumber() : 0;
    const total = n(r.horasFeriado) * hora * RECARGO_FERIADO.toNumber();
    ws.getCell(`B${fila}`).value = r.entity.name;
    ws.getCell(`C${fila}`).value = f(`C${primera + i}`, n(tarifa));
    ws.getCell(`C${fila}`).numFmt = MILES;
    ws.getCell(`D${fila}`).value = f(`C${fila}/8`, hora);
    ws.getCell(`D${fila}`).numFmt = MILES;
    ws.getCell(`E${fila}`).value = n(r.horasFeriado);
    ws.getCell(`E${fila}`).numFmt = "#,##0.##";
    ws.getCell(`E${fila}`).alignment = { horizontal: "center" };
    ws.getCell(`F${fila}`).value = RECARGO_FERIADO.toNumber();
    ws.getCell(`F${fila}`).numFmt = "0.00";
    ws.getCell(`F${fila}`).alignment = { horizontal: "right" };
    ws.getCell(`G${fila}`).value = f(`D${fila}*E${fila}*F${fila}`, total);
    ws.getCell(`G${fila}`).numFmt = PESOS_CON_DECIMALES;
    ws.getRow(fila).height = 20;
  });
  const ultimaFeriado = primeraFeriado + renglones.length - 1;
  for (const col of ["B", "C", "D", "E", "F", "G"]) ws.getCell(`${col}${ultimaFeriado}`).border = { bottom: GRUESO };
  const totalFeriado = renglones.reduce((a, { r, tarifa }) => a + n(r.horasFeriado) * (tarifa ? valorHora(tarifa).toNumber() : 0) * 0.5, 0);
  ws.getCell(`F${ultimaFeriado + 1}`).value = "Total";
  ws.getCell(`F${ultimaFeriado + 1}`).font = { bold: true, italic: true };
  ws.getCell(`F${ultimaFeriado + 1}`).alignment = { horizontal: "right" };
  ws.getCell(`G${ultimaFeriado + 1}`).value = f(`SUM(G${primeraFeriado}:G${ultimaFeriado})`, totalFeriado);
  ws.getCell(`G${ultimaFeriado + 1}`).numFmt = PESOS;
  ws.getCell(`G${ultimaFeriado + 1}`).font = { bold: true, italic: true };

  pie(ws, ultimaFeriado + 3, planilla);
}

function mensual(ws: ExcelJS.Worksheet, { planilla, renglones }: Planilla) {
  // A Nombre · B Sueldo del mes · C Monotributo · D Adelantos · E Sueldo · F Redondeo · G Comentarios
  ws.columns = [{ width: 28 }, { width: 16 }, { width: 15 }, { width: 14 }, { width: 15 }, { width: 15 }, { width: 40 }];
  titulo(ws, nombreDePlanilla(planilla).toUpperCase(), 7);
  encabezado(ws, 2, ["Nombre y Apellido", "Sueldo del mes", "Monotributo", "Adelantos", "Sueldo", "Redondeo", "Comentarios"], [5, 6]);
  const primera = 3;
  renglones.forEach(({ r, tarifa, cuenta }, i) => {
    const fila = primera + i;
    const adelantos = adelantosDe(cuenta);
    const mono = cuenta ? cuenta.monotributo.toNumber() : 0;
    const valores: [string, ExcelJS.CellValue, string?][] = [
      ["A", r.entity.name],
      ["B", n(tarifa), PESOS],
      ["C", mono ? mono : null, PESOS],
      ["D", adelantos ? adelantos : null, PESOS],
      ["E", f(`B${fila}+C${fila}-D${fila}`, n(tarifa) + mono - adelantos), PESOS],
      ["F", cuenta ? cuenta.pagado.toNumber() : null, PESOS],
      ["G", r.comentario],
    ];
    for (const [col, valor, formato] of valores) {
      const c = ws.getCell(`${col}${fila}`);
      c.value = valor;
      c.border = BORDES;
      if (formato) c.numFmt = formato;
    }
  });
  const ultima = primera + renglones.length - 1;
  const totales = ultima + 1;
  ws.getCell(`A${totales}`).value = "Total";
  for (const col of ["C", "D", "E", "F"]) {
    const c = ws.getCell(`${col}${totales}`);
    c.value = { formula: `SUM(${col}${primera}:${col}${ultima})` };
    c.numFmt = PESOS;
    c.border = RECUADRO;
  }
  pie(ws, totales + 2, planilla);
}

function pie(ws: ExcelJS.Worksheet, fila: number, planilla: Planilla["planilla"]) {
  const c = ws.getCell(`B${fila}`);
  c.value =
    planilla.estado === "CERRADA"
      ? `Pagada el ${formatFecha(planilla.fechaDePago)}.${planilla.notas ? ` ${planilla.notas}` : ""}`
      : `Borrador: todavía no se pagó. Bajada el ${formatFecha(new Date())}.${planilla.notas ? ` ${planilla.notas}` : ""}`;
  c.font = { italic: true, color: { argb: "FF6B7280" } };
}
