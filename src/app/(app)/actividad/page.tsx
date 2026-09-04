import { Search } from "lucide-react";
import Link from "next/link";
import type { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatDateTime } from "@/lib/period";

const ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: "Alta",
  UPDATE: "Edición",
  DELETE: "Borrado",
};

const ACTION_COLORS: Record<AuditAction, string> = {
  CREATE: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  UPDATE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  DELETE: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export default async function ActividadPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; entityType?: string; from?: string; to?: string }>;
}) {
  const { q, entityType, from, to } = await searchParams;
  await requireRole(["ADMIN"]);

  const searchTerm = q?.trim();

  const [logs, entityTypeRows] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
                ...(to ? { lt: new Date(new Date(`${to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000) } : {}),
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
  ]);

  const entityTypes = entityTypeRows.map((r) => r.entityType);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Actividad</h1>
        <p className="text-sm text-foreground/60">{logs.length} operaciones registradas (últimas 200)</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <form className="flex flex-1 min-w-[240px] flex-wrap items-end gap-2">
          {entityType && <input type="hidden" name="entityType" value={entityType} />}
          <div className="relative flex-1 min-w-[200px]">
            <label className="text-xs text-foreground/60">Buscar</label>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Usuario o resumen…"
                className="w-full rounded-lg border border-foreground/20 bg-background py-2 pl-9 pr-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="from">
              Desde
            </label>
            <input
              id="from"
              type="date"
              name="from"
              defaultValue={from}
              className="rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="to">
              Hasta
            </label>
            <input
              id="to"
              type="date"
              name="to"
              defaultValue={to}
              className="rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <button type="submit" className="rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm hover:bg-foreground/5">
            Buscar
          </button>
        </form>
      </div>

      <div className="flex flex-wrap gap-1">
        <Link
          href={{ pathname: "/actividad", query: { ...(q ? { q } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) } }}
          className={`rounded px-3 py-1.5 text-sm ${
            !entityType ? "bg-primary text-primary-foreground" : "border border-foreground/20 hover:bg-foreground/5"
          }`}
        >
          Todos
        </Link>
        {entityTypes.map((et) => (
          <Link
            key={et}
            href={{
              pathname: "/actividad",
              query: { ...(q ? { q } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), entityType: et },
            }}
            className={`rounded px-3 py-1.5 text-sm ${
              entityType === et ? "bg-primary text-primary-foreground" : "border border-foreground/20 hover:bg-foreground/5"
            }`}
          >
            {et}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Usuario</th>
              <th className="py-2 pr-4">Acción</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">Resumen</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4 whitespace-nowrap">
                  {formatDateTime(log.createdAt)}
                </td>
                <td className="py-2 pr-4">{log.user.name}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-1 text-xs font-medium ${ACTION_COLORS[log.action]}`}>
                    {ACTION_LABELS[log.action]}
                  </span>
                </td>
                <td className="py-2 pr-4">{log.entityType}</td>
                <td className="py-2 pr-4">{log.summary}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-foreground/40">
                  {q || entityType || from || to ? "No hay actividad con este filtro." : "Todavía no hay actividad registrada."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
