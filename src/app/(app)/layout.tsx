import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { NAV_ITEMS, ROLE_LABELS } from "@/lib/nav";
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
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={32} height={32} className="shrink-0" />
          <div>
            <p className="font-semibold">Envasadora</p>
            <p className="text-sm text-black/60">
              {user.name} · {ROLE_LABELS[user.role]}
            </p>
          </div>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="text-sm underline underline-offset-2">
            Cerrar sesión
          </button>
        </form>
      </header>
      <div className="flex flex-1">
        <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-black/10 p-4">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-3 py-2 text-sm hover:bg-primary/15"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
