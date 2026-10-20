import "server-only";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { formatFecha } from "@/lib/period";
import { valorHora, RECARGO_FERIADO } from "@/lib/sueldos-calculo";
import { getRenglonesCalculados, nombreDePlanilla } from "@/lib/sueldos";

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
 * valor hora es el jornal ÷ 8, el sueldo es horas × valor hora más el feriado menos los adelantos—
 * así se puede retocar ahí mismo como antes. Los totales suman todas las filas.
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
    c.alignment = { vertical: "middle", horizontal: i >= 2 && i <= 7 ? "center" : "left" };
  });
  ws.getRow(fila).height = 22;
}

function semanal(ws: ExcelJS.Worksheet, { planilla, renglones }: Planilla) {
  // A Usuario · B Nombre · C Jornal · D Valor hora · E Horas · F Adelantos · G Sueldo · H Redondeo · I Comentarios
  ws.columns = [
    { width: 9 },
    { width: 24 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 15 },
    { width: 15 },
    { width: 46 },
  ];
  titulo(ws, nombreDePlanilla(planilla).toUpperCase(), 9);
  encabezado(
    ws,
    2,
    ["Usuario", "Nombre y Apellido", "Valor Jornal", "Valor hora", "Total horas", "Adelantos", "Sueldo", "Redondeo", "Comentarios"],
    [7, 8]
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
    // Lo que se descuenta: la Cuenta 1 y lo que tenía a cuenta. Si se le debía de antes, suma.
    const adelantos = cuenta ? cuenta.descuentoCuenta1.plus(cuenta.descuentoACuenta).minus(cuenta.deudaAnterior).toNumber() : 0;
    const feriado = n(r.horasFeriado) * hora * RECARGO_FERIADO.toNumber();
    const comentario = [
      r.comentario,
      cuenta?.descuentoCuenta1.greaterThan(0) ? "incluye el sueldo de la Cuenta 1" : null,
      cuenta?.deudaAnterior.greaterThan(0) ? "incluye lo que se le debía" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const valores: [string, ExcelJS.CellValue, string?][] = [
      ["A", null],
      ["B", r.entity.name],
      ["C", jornal, MILES],
      ["D", f(`C${fila}/8`, hora), CON_DECIMALES],
      ["E", n(r.horas), "#,##0.##"],
      ["F", adelantos ? adelantos : null, PESOS],
      ["G", f(`D${fila}*E${fila}+G${filaFeriado}-F${fila}`, n(r.horas) * hora + feriado - adelantos), PESOS],
      ["H", cuenta ? cuenta.pagado.toNumber() : null, PESOS],
      ["I", comentario || null],
    ];
    for (const [col, valor, formato] of valores) {
      const c = ws.getCell(`${col}${fila}`);
      c.value = valor;
      c.border = BORDES;
      if (formato) c.numFmt = formato;
      if (col === "C" || col === "D" || col === "E") c.alignment = { horizontal: col === "E" ? "center" : "right" };
    }
    ws.getRow(fila).height = 20;
  });

  // Totales: los de la planilla vieja no llegaban a la última fila, o salteaban una vacía.
  const totalAdelantos = renglones.reduce((a, { cuenta }) => a + (cuenta ? cuenta.descuentoCuenta1.plus(cuenta.descuentoACuenta).minus(cuenta.deudaAnterior).toNumber() : 0), 0);
  const totalSueldo = renglones.reduce((a, { cuenta }) => a + (cuenta ? cuenta.aPagar.toNumber() : 0), 0);
  const totalRedondeo = renglones.reduce((a, { cuenta }) => a + (cuenta ? cuenta.pagado.toNumber() : 0), 0);
  const rango = (col: string) => `${col}${primera}:${col}${ultima}`;
  ws.getCell(`E${totales}`).value = "Total";
  ws.getCell(`E${totales}`).alignment = { horizontal: "center" };
  ws.getCell(`F${totales}`).value = f(`SUM(${rango("F")})`, totalAdelantos);
  ws.getCell(`G${totales}`).value = f(`SUM(${rango("G")})`, totalSueldo);
  ws.getCell(`H${totales}`).value = f(`SUM(${rango("H")})`, totalRedondeo);
  for (const col of ["E", "F", "G", "H"]) {
    const c = ws.getCell(`${col}${totales}`);
    c.border = RECUADRO;
    c.font = { size: 12 };
    if (col !== "E") {
      c.numFmt = PESOS;
      c.alignment = { horizontal: "center" };
    }
  }
  // Lo que costó la semana: lo pagado ahora más lo que ya había cobrado a cuenta.
  const costo = ws.getCell(`F${totales + 1}`);
  costo.value = f(`F${totales}+G${totales}`, totalAdelantos + totalSueldo);
  costo.numFmt = PESOS;
  costo.border = RECUADRO;
  costo.alignment = { horizontal: "center" };

  // El feriado: la misma cuenta que hacía a mano, horas × valor hora × 0,5.
  const titulosFeriado: [string, string][] = [
    ["B", "Nombre"],
    ["C", "Jornal"],
    ["D", "Valor hora"],
    ["E", "Horas"],
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
  // A Nombre · B Sueldo del mes · C Adelantos · D Sueldo · E Redondeo · F Comentarios
  ws.columns = [{ width: 28 }, { width: 16 }, { width: 14 }, { width: 15 }, { width: 15 }, { width: 46 }];
  titulo(ws, nombreDePlanilla(planilla).toUpperCase(), 6);
  encabezado(ws, 2, ["Nombre y Apellido", "Sueldo del mes", "Adelantos", "Sueldo", "Redondeo", "Comentarios"], [4, 5]);
  const primera = 3;
  renglones.forEach(({ r, tarifa, cuenta }, i) => {
    const fila = primera + i;
    const adelantos = cuenta ? cuenta.descuentoCuenta1.plus(cuenta.descuentoACuenta).minus(cuenta.deudaAnterior).toNumber() : 0;
    const valores: [string, ExcelJS.CellValue, string?][] = [
      ["A", r.entity.name],
      ["B", n(tarifa), PESOS],
      ["C", adelantos ? adelantos : null, PESOS],
      ["D", f(`B${fila}-C${fila}`, n(tarifa) - adelantos), PESOS],
      ["E", cuenta ? cuenta.pagado.toNumber() : null, PESOS],
      ["F", r.comentario],
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
  for (const col of ["C", "D", "E"]) {
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
