import "server-only";
import * as XLSX from "xlsx";
import { UserError } from "@/lib/user-error";
import { leerAttendanceRecord, type ExportacionDelFichero } from "@/lib/fichero";

/**
 * Abre la exportación del reloj (el "AllReport.xls" que baja Adriana, un Excel viejo) y lee la hoja
 * de marcas. Acepta también el mismo archivo guardado como .xlsx.
 */
export function leerArchivoDelFichero(contenido: ArrayBuffer): ExportacionDelFichero {
  let libro: XLSX.WorkBook;
  try {
    libro = XLSX.read(new Uint8Array(contenido), { type: "array", dense: true });
  } catch {
    throw new UserError("No pude abrir el archivo. Tiene que ser el Excel que exporta el reloj (AllReport).");
  }
  const hoja = libro.Sheets["Attendance Record"];
  if (!hoja) {
    throw new UserError('El archivo no tiene la hoja "Attendance Record". ¿Es la exportación del reloj (AllReport)?');
  }
  const filas = XLSX.utils.sheet_to_json<(string | null)[]>(hoja, { header: 1, raw: false, defval: null, blankrows: true });
  try {
    return leerAttendanceRecord(filas);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
}
