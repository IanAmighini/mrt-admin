import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/nav";
import { createUser, toggleUserActive, updateUserRole } from "./actions";

export default async function UsuariosPage() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">Usuarios</h1>
        <p className="text-sm text-foreground/60">
          Alta de usuarios y asignación de rol (Admin, Carga diaria, Solo lectura).
        </p>
      </div>

      <form
        action={createUser}
        className="grid max-w-xl gap-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4"
      >
        <h2 className="text-sm font-semibold">Nuevo usuario</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="name">
              Nombre
            </label>
            <input
              id="name"
              name="name"
              required
              className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="password">
              Contraseña temporal
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="role">
              Rol
            </label>
            <select
              id="role"
              name="role"
              required
              defaultValue="CARGA_DIARIA"
              className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
            >
              <option value="ADMIN">Admin</option>
              <option value="CARGA_DIARIA">Carga diaria</option>
              <option value="SOLO_LECTURA">Solo lectura</option>
            </select>
          </div>
        </div>
        <button
          type="submit"
          className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
        >
          Crear usuario
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Nombre</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Rol</th>
              <th className="py-2 pr-4">Estado</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4">{u.name}</td>
                <td className="py-2 pr-4">{u.email}</td>
                <td className="py-2 pr-4">
                  <form action={updateUserRole} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <select
                      name="role"
                      defaultValue={u.role}
                      className="rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-xs"
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="CARGA_DIARIA">Carga diaria</option>
                      <option value="SOLO_LECTURA">Solo lectura</option>
                    </select>
                    <button type="submit" className="text-xs underline underline-offset-2">
                      Guardar
                    </button>
                  </form>
                </td>
                <td className="py-2 pr-4">{u.active ? "Activo" : "Inactivo"}</td>
                <td className="py-2 pr-4">
                  <form action={toggleUserActive}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="active" value={String(u.active)} />
                    <button type="submit" className="text-xs underline underline-offset-2">
                      {u.active ? "Desactivar" : "Activar"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground/40">
        Roles: {Object.entries(ROLE_LABELS).map(([k, v]) => `${v} (${k})`).join(" · ")}
      </p>
    </div>
  );
}
