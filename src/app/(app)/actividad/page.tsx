import type { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatDateTime, parseFecha } from "@/lib/period";
import { FilterBar, FiltroBuscar, FiltroFechas, FiltroSelect } from "@/components/ui/FilterBar";
import { Table, TableEmpty, Td, Th, Thead, Tr } from "@/components/ui/Table";
import { resolverDestinos } from "@/lib/actividad-destino";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

const ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: "Alta",
  UPDATE: "Edición",
  DELETE: "Borrado",
};

const ACTION_ORDER: AuditAction[] = ["CREATE", "UPDATE", "DELETE"];

const ACTION_COLORS: Record<AuditAction, string> = {
  CREATE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  UPDATE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  DELETE: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export default async function ActividadPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    entityType?: string;
    action?: string;
    userId?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { q, entityType, action, userId, from, to } = await searchParams;
  await requireRole(["ADMIN"]);

  const searchTerm = q?.trim();
  const accionValida = ACTION_ORDER.includes(action as AuditAction) ? (action as AuditAction) : undefined;

  const [logs, entityTypeRows, usuarios] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(accionValida ? { action: accionValida } : {}),
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: parseFecha(from) } : {}),
                ...(to ? { lt: new Date(parseFecha(to).getTime() + 24 * 60 * 60 * 1000) } : {}),
              },
            }
          : {}),
        ...(searchTerm
          ? {
              OR: [
                { summary: { contains: searchTerm, mode: "insensitive" } },
                { user: { name: { contains: searchTerm, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const entityTypes = entityTypeRows.map((r) => r.entityType);
  // A dónde lleva cada fila. No hay un "detalle" que mostrar —el registro guarda qué se tocó, no
  // el antes y el después— así que lo útil es poder abrir el registro afectado.
  const destinos = await resolverDestinos(logs);
  const hayFiltro = Boolean(searchTerm || entityType || accionValida || userId || from || to);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Actividad</h1>
        <p className="text-sm text-foreground/60">
          {hayFiltro
            ? `${logs.length} ${logs.length === 1 ? "operación" : "operaciones"} con este filtro`
            : `Las últimas ${logs.length} operaciones`}
        </p>
      </div>

      <FilterBar limpiarHref="/actividad" hayFiltro={hayFiltro}>
        <FiltroBuscar defaultValue={q} placeholder="Usuario o resumen…" />
        <FiltroSelect
          label="Tipo"
          name="entityType"
          defaultValue={entityType}
          opciones={entityTypes.map((et) => ({ value: et, label: et }))}
        />
        <FiltroSelect
          label="Acción"
          name="action"
          defaultValue={accionValida}
          todos="Todas"
          opciones={ACTION_ORDER.map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
        />
        <FiltroSelect
          label="Usuario"
          name="userId"
          defaultValue={userId}
          opciones={usuarios.map((u) => ({ value: u.id, label: u.name }))}
        />
        <FiltroFechas from={from} to={to} />
      </FilterBar>

      <Table>
        <Thead>
          <Th>Fecha</Th>
          <Th>Usuario</Th>
          <Th>Acción</Th>
          <Th>Tipo</Th>
          <Th>Resumen</Th>
          <Th />
        </Thead>
        <tbody>
          {logs.map((log) => {
            const destino = destinos.get(log.id);
            return (
            <Tr key={log.id} className={destino ? "hover:bg-foreground/[0.03]" : ""}>
              <Td className="whitespace-nowrap">{formatDateTime(log.createdAt)}</Td>
              <Td className="whitespace-nowrap">{log.user.name}</Td>
              <Td>
                <span className={`rounded px-2 py-1 text-xs font-medium ${ACTION_COLORS[log.action]}`}>
                  {ACTION_LABELS[log.action]}
                </span>
              </Td>
              <Td>{log.entityType}</Td>
              <Td>
                {destino ? (
                  <Link href={destino} className="block hover:underline underline-offset-2">
                    {log.summary}
                  </Link>
                ) : (
                  log.summary
                )}
              </Td>
              <Td className="w-6">
                {destino && (
                  <Link href={destino} aria-label="Ver el registro" className="block text-foreground/30 hover:text-foreground">
                    <ChevronRight size={16} />
                  </Link>
                )}
              </Td>
            </Tr>
            );
          })}
          {logs.length === 0 && (
            <TableEmpty colSpan={6}>
              {hayFiltro ? "No hay actividad con este filtro." : "Todavía no hay actividad registrada."}
            </TableEmpty>
          )}
        </tbody>
      </Table>
    </div>
  );
}
