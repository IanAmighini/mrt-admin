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
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const entityTypes = entityTypeRows.map((r) => r.entityType);
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

      {/* Un solo formulario con todo adentro: antes el tipo eran veinte botones en dos renglones
          —y crecen solos cada vez que se audita algo nuevo— mientras la fecha y el buscador
          peleaban por el mismo renglón de arriba. */}
      <form className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs text-foreground/60" htmlFor="q">
              Buscar
            </label>
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40"
              />
              <input
                id="q"
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Usuario o resumen…"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="entityType">
              Tipo
            </label>
            <select id="entityType" name="entityType" defaultValue={entityType ?? ""} className={inputClass}>
              <option value="">Todos</option>
              {entityTypes.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="action">
              Acción
            </label>
            <select id="action" name="action" defaultValue={accionValida ?? ""} className={inputClass}>
              <option value="">Todas</option>
              {ACTION_ORDER.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="userId">
              Usuario
            </label>
            <select id="userId" name="userId" defaultValue={userId ?? ""} className={inputClass}>
              <option value="">Todos</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="from">
              Desde
            </label>
            <input id="from" type="date" name="from" defaultValue={from} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-foreground/60" htmlFor="to">
              Hasta
            </label>
            <input id="to" type="date" name="to" defaultValue={to} className={inputClass} />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              Buscar
            </button>
            {hayFiltro && (
              <Link
                href="/actividad"
                className="rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:bg-foreground/5"
              >
                Limpiar
              </Link>
            )}
          </div>
        </div>
      </form>

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
                <td className="py-2 pr-4 whitespace-nowrap">{log.user.name}</td>
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
                  {hayFiltro ? "No hay actividad con este filtro." : "Todavía no hay actividad registrada."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary";
