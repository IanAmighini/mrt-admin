import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { navEntriesForRole, ROLE_LABELS } from "@/lib/nav";
import { SidebarNav } from "@/components/SidebarNav";
import { SearchPalette } from "@/components/SearchPalette";
import { AbrirCalendario } from "@/components/AbrirCalendario";
import { signOut } from "@/auth";
import { cookies } from "next/headers";
import { COOKIE_HUBO_SESION } from "@/lib/sesion";
import { FormModal } from "@/components/Modal";
import { cambiarMiContrasena } from "./cuenta/actions";

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const entries = navEntriesForRole(user.role);

  return (
    <div className="flex min-h-screen flex-col">
      <AbrirCalendario />
      <div className="h-1 bg-primary" />
      <header className="flex items-center justify-between border-b border-foreground/10 bg-background px-6 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={32} height={32} className="shrink-0 rounded-lg" />
          <div>
            <p className="font-semibold">MRT</p>
            <p className="text-sm text-foreground/60">
              {user.name} · {ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>
        {/* Montada acá y no en cada página: un solo listener global de ⌘K para toda la app, y la
            paleta sobrevive a la navegación sin volver a registrarlo. */}
        <div className="flex items-center gap-1">
          <SearchPalette />
          <FormModal triggerLabel="Cambiar contraseña" title="Cambiar mi contraseña" action={cambiarMiContrasena} soloIcono iconName="key" maxWidthClass="max-w-sm">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="pass-actual">
                Contraseña actual
              </label>
              <input id="pass-actual" name="actual" type="password" required autoComplete="current-password" className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="pass-nueva">
                Contraseña nueva
              </label>
              <input id="pass-nueva" name="nueva" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
              <p className="text-xs text-foreground/50">Al menos 8 caracteres.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="pass-repetida">
                Repetí la nueva
              </label>
              <input id="pass-repetida" name="repetida" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
            </div>
            <button
              type="submit"
              className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              Cambiar contraseña
            </button>
          </FormModal>
          <form
            action={async () => {
              "use server";
              // Primero la marca: si queda, el login diría que la sesión se cerró por inactividad
              // cuando en realidad la cerró quien está sentado acá. Y después del signOut no hay
              // chance, porque redirige tirando.
              (await cookies()).delete(COOKIE_HUBO_SESION);
              await signOut({ redirectTo: "/login" });
            }}
          >
            {/* Solo el ícono: el encabezado ya está apretado en el celular. El nombre accesible
                lo dan title y aria-label, que si no el botón queda sin etiqueta. */}
            <button
              type="submit"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="flex items-center rounded-lg px-3 py-2 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              <LogOut size={16} />
            </button>
          </form>
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <SidebarNav entries={entries} />
        {/* `min-w-0`: sin esto el contenido se estira hasta el ancho de la tabla más ancha y la página
            entera se corre al costado, en vez de que la tabla se deslice adentro de su lugar. */}
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
