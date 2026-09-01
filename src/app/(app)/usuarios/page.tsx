import { Search } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { ROLE_LABELS } from "@/lib/nav";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { createUser, toggleUserActive, updateUser } from "./actions";

const ESTADO_FILTERS: { value: "" | "activos" | "inactivos"; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "activos", label: "Activos" },
  { value: "inactivos", label: "Inactivos" },
];

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const selectClass = inputClass;

export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string }>;
}) {
  const { q, estado } = await searchParams;
  const admin = await requireRole(["ADMIN"]);

  const estadoFilter = ESTADO_FILTERS.some((f) => f.value === estado) ? (estado as "" | "activos" | "inactivos") : "";
  const searchTerm = q?.trim().toLowerCase();

  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  const filteredUsers = users.filter((u) => {
    if (estadoFilter === "activos" && !u.active) return false;
    if (estadoFilter === "inactivos" && u.active) return false;
    if (searchTerm && !u.name.toLowerCase().includes(searchTerm) && !u.email.toLowerCase().includes(searchTerm)) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold mb-1">Usuarios</h1>
          <p className="text-sm text-foreground/60">{filteredUsers.length} usuarios registrados</p>
        </div>
        <FormModal triggerLabel="Nuevo usuario" title="Nuevo usuario" action={createUser}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="name">
                Nombre
              </label>
              <input id="name" name="name" required className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="email">
                Email
              </label>
              <input id="email" name="email" type="email" required className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="password">
                Contraseña temporal
              </label>
              <input id="password" name="password" type="password" required minLength={8} className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="role">
                Rol
              </label>
              <select id="role" name="role" required defaultValue="SECRETARIA" className={selectClass}>
                <option value="ADMIN">Admin</option>
                <option value="SOLO_LECTURA">Solo lectura</option>
                <option value="SECRETARIA">Secretaria</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            Crear usuario
          </button>
        </FormModal>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form className="flex flex-1 min-w-[240px] gap-2">
          {estadoFilter && <input type="hidden" name="estado" value={estadoFilter} />}
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Buscar por nombre o email…"
              className="w-full rounded-lg border border-foreground/20 bg-background py-2 pl-9 pr-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <button type="submit" className="rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm hover:bg-foreground/5">
            Buscar
          </button>
        </form>
        <div className="flex flex-wrap gap-1">
          {ESTADO_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={{ pathname: "/usuarios", query: { ...(q ? { q } : {}), ...(f.value ? { estado: f.value } : {}) } }}
              className={`rounded px-3 py-1.5 text-sm ${
                estadoFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "border border-foreground/20 hover:bg-foreground/5"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Nombre</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Rol</th>
              <th className="py-2 pr-4">Estado</th>
              <th className="py-2 pr-4">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr key={u.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4">{u.name}</td>
                <td className="py-2 pr-4">{u.email}</td>
                <td className="py-2 pr-4">{ROLE_LABELS[u.role]}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      u.active
                        ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                        : "bg-foreground/10 text-foreground/60"
                    }`}
                  >
                    {u.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-3">
                    <FormModal triggerLabel="Editar" iconName="edit" title="Editar usuario" action={updateUser}>
                      <input type="hidden" name="id" value={u.id} />
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-sm" htmlFor={`name-${u.id}`}>
                            Nombre
                          </label>
                          <input id={`name-${u.id}`} name="name" required defaultValue={u.name} className={inputClass} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm" htmlFor={`email-${u.id}`}>
                            Email
                          </label>
                          <input
                            id={`email-${u.id}`}
                            name="email"
                            type="email"
                            required
                            defaultValue={u.email}
                            className={inputClass}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm" htmlFor={`role-${u.id}`}>
                            Rol
                          </label>
                          <select id={`role-${u.id}`} name="role" required defaultValue={u.role} className={selectClass}>
                            <option value="ADMIN">Admin</option>
                            <option value="SOLO_LECTURA">Solo lectura</option>
                            <option value="SECRETARIA">Secretaria</option>
                          </select>
                        </div>
                      </div>
                      <button
                        type="submit"
                        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
                      >
                        Guardar cambios
                      </button>
                    </FormModal>
                    {u.active ? (
                      u.id !== admin.id && (
                        <DeleteButton
                          action={toggleUserActive}
                          hiddenName="id"
                          hiddenValue={u.id}
                          label="Eliminar"
                          confirmMessage="¿Eliminar este usuario? No va a poder iniciar sesión, pero se conserva todo lo que cargó en el sistema."
                        >
                          <input type="hidden" name="active" value="true" />
                        </DeleteButton>
                      )
                    ) : (
                      <form action={toggleUserActive}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="active" value="false" />
                        <button type="submit" className="text-xs underline underline-offset-2">
                          Reactivar
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-foreground/40">
                  {q || estadoFilter ? "No hay usuarios con este filtro." : "Todavía no hay usuarios cargados."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground/40">
        Roles: {Object.entries(ROLE_LABELS).map(([k, v]) => `${v} (${k})`).join(" · ")}
      </p>
    </div>
  );
}
