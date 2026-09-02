import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth-helpers";
import { findBySlugOrId } from "@/lib/slug-lookup";
import { CIRCUIT_BY_SLUG } from "@/lib/labels";
import { addDays } from "@/lib/period";
import { getAccountStatement } from "@/lib/account-statement";
import { buildStatementSheets, statementFilename } from "@/lib/statement-excel";
import { buildWorkbook, excelResponse } from "@/lib/excel";

/**
 * Descarga del estado de cuenta en Excel. Los Route Handlers no ejecutan el layout, así que el
 * chequeo de sesión va acá explícito — y devuelve 401 en texto plano en vez de redirigir al login,
 * porque para un link de descarga un redirect termina guardando el HTML del login como .xlsx.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string; circuit: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const { entityId: entityParam, circuit: circuitSlug } = await params;
  const circuit = CIRCUIT_BY_SLUG[circuitSlug];
  if (!circuit) return new Response("Circuito inválido", { status: 404 });

  const entity = await findBySlugOrId(
    () => prisma.entity.findUnique({ where: { slug: entityParam } }),
    (id) => prisma.entity.findUnique({ where: { id } }),
    entityParam
  );
  if (!entity) return new Response("Entidad inexistente", { status: 404 });

  const account = await prisma.account.findUnique({
    where: { entityId_circuit: { entityId: entity.id, circuit } },
  });
  if (!account) return new Response("Cuenta inexistente", { status: 404 });

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  const statement = await getAccountStatement({
    accountId: account.id,
    from: from ? new Date(`${from}T00:00:00`) : null,
    // El "hasta" de la UI es inclusivo; acá se espera exclusivo.
    to: to ? addDays(new Date(`${to}T00:00:00`), 1) : null,
  });

  const workbook = await buildWorkbook(buildStatementSheets(statement));
  return excelResponse(workbook, statementFilename(statement));
}
