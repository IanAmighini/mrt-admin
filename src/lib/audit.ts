import "server-only";
import { Prisma, type AuditAction } from "@prisma/client";
import { prisma } from "./prisma";
import { formatFecha } from "./period";

/** Una fila del detalle: qué campo cambió y de qué a qué. */
export type CambioDeCampo = { campo: string; antes: string | null; despues: string | null };

export async function logAudit(
  tx: Prisma.TransactionClient | typeof prisma,
  params: {
    userId: string;
    action: AuditAction;
    entityType: string;
    entityId?: string;
    summary: string;
    /** El antes y el después, campo por campo. Ver `diffDeCampos`. */
    cambios?: CambioDeCampo[];
  }
) {
  const { cambios, ...resto } = params;
  await tx.auditLog.create({
    data: {
      ...resto,
      cambios: cambios && cambios.length > 0 ? (cambios as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
}

/**
 * Un valor guardado, escrito como para leerlo en una tabla.
 *
 * Las fechas se formatean con el mismo criterio que el resto de la app —en UTC, porque así se
 * guardan— y los decimales salen con su cantidad de decimales real: el detalle de un cambio no es
 * lugar para redondear.
 */
function aTexto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return formatFecha(valor);
  if (valor instanceof Prisma.Decimal) return valor.toString();
  if (typeof valor === "boolean") return valor ? "sí" : "no";
  const texto = String(valor);
  return texto === "" ? null : texto;
}

/**
 * Compara dos versiones de un registro y devuelve sólo lo que cambió.
 *
 * `etiquetas` decide **qué campos se miran y cómo se llaman**: lo que no está en la lista no se
 * compara. Es a propósito — un `updatedAt` o un id interno no le dicen nada a nadie, y el detalle
 * sirve justamente porque no tiene ruido.
 *
 * En un alta se pasa `antes: null` y salen todos los campos con valor; en un borrado, al revés.
 */
export function diffDeCampos(
  antes: Record<string, unknown> | null,
  despues: Record<string, unknown> | null,
  etiquetas: Record<string, string>
): CambioDeCampo[] {
  const cambios: CambioDeCampo[] = [];
  for (const [campo, etiqueta] of Object.entries(etiquetas)) {
    const a = aTexto(antes?.[campo]);
    const d = aTexto(despues?.[campo]);
    if (a === d) continue;
    // En un alta o un borrado no hay nada que comparar: se listan los campos que tienen valor.
    if (!antes && d === null) continue;
    if (!despues && a === null) continue;
    cambios.push({ campo: etiqueta, antes: a, despues: d });
  }
  return cambios;
}
