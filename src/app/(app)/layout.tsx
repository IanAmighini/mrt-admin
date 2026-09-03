import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { NAV_ITEMS, ROLE_LABELS } from "@/lib/nav";
import { SidebarNav } from "@/components/SidebarNav";
import { SearchPalette } from "@/components/SearchPalette";
import { signOut } from "@/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex min-h-screen flex-col">
      <div className="h-1 bg-primary" />
      <header className="flex items-center justify-between border-b border-foreground/10 bg-background px-6 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={32} height={32} className="shrink-0 rounded-lg" />
          <div>
            <p className="font-semibold">Envasadora</p>
            <p className="text-sm text-foreground/60">
              {user.name} · {ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>
        {/* Montada acá y no en cada página: un solo listener global de ⌘K para toda la app, y la
            paleta sobrevive a la navegación sin volver a registrarlo. */}
        <div className="flex items-center gap-1">
          <SearchPalette />
          <form
            action={async () => {
              "use server";
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
        <SidebarNav items={items} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
