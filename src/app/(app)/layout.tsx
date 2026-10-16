import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { navEntriesForRole, ROLE_LABELS } from "@/lib/nav";
import { SidebarNav } from "@/components/SidebarNav";
import { SearchPalette } from "@/components/SearchPalette";
import { AbrirCalendario } from "@/components/AbrirCalendario";
import { signOut } from "@/auth";
import { cookies } from "next/headers";
import { COOKIE_HUBO_SESION } from "@/lib/sesion";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const entries = navEntriesForRole(user.role);

  return (
    <div className="flex min-h-screen flex-col print:min-h-0">
      <AbrirCalendario />
      <div className="h-1 bg-primary print:hidden" />
      <header className="flex items-center gap-3 border-b border-foreground/10 bg-background px-4 py-3.5 shadow-sm sm:gap-6 md:px-6 print:hidden">
        <div className="flex shrink-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={32} height={32} className="shrink-0 rounded-lg" />
          <div>
            <p className="font-semibold">MRT</p>
            <p className="hidden text-sm text-foreground/60 sm:block">
              {user.name} · {ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>
        {/* Montada acá y no en cada página: un solo listener global de ⌘K para toda la app, y la
            paleta sobrevive a la navegación sin volver a registrarlo. */}
        <div className="flex min-w-0 flex-1 justify-center">
          <SearchPalette />
        </div>
        <div className="flex shrink-0 items-center">
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
