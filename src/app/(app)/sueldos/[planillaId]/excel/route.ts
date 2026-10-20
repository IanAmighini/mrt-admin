import { getCurrentUser } from "@/lib/auth-helpers";
import { excelResponse } from "@/lib/excel";
import { planillaEnExcel } from "@/lib/sueldos-excel";

/**
 * La planilla en Excel. Cuelga de /sueldos, así el middleware le aplica el mismo permiso que a la
 * pantalla; igual se repite acá, porque un Route Handler no pasa por el layout.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ planillaId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  if (!["ADMIN", "SECRETARIA", "SOLO_LECTURA"].includes(user.role)) {
    return new Response("Sin permisos para ver sueldos", { status: 403 });
  }
  const { planillaId } = await params;
  const excel = await planillaEnExcel(planillaId);
  if (!excel) return new Response("No existe esa planilla", { status: 404 });
  return excelResponse(excel.archivo, excel.nombre);
}
