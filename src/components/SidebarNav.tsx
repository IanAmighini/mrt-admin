"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Building2,
  ClipboardList,
  Contact,
  Factory,
  History,
  Home,
  Landmark,
  Menu,
  Package,
  Send,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/nav";

const ICONS_BY_HREF: Record<string, LucideIcon> = {
  "/": Home,
  "/dashboard-clientes": Users,
  "/dashboard-proveedores": Truck,
  "/stock": Package,
  "/clientes": Contact,
  "/proveedores": Building2,
  "/pedidos": ClipboardList,
  "/entregas": Send,
  "/compras": ShoppingCart,
  "/pagos-clientes": Wallet,
  "/pagos-proveedores": Banknote,
  "/tesoreria": Landmark,
  "/produccion": Factory,
  "/usuarios": UserCog,
  "/actividad": History,
};

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = items.map((item) => {
    const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    const Icon = ICONS_BY_HREF[item.href] ?? Home;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setOpen(false)}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive
            ? "bg-primary text-primary-foreground font-medium"
            : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
        }`}
      >
        <Icon size={17} strokeWidth={2} className="shrink-0" />
        {item.label}
      </Link>
    );
  });

  return (
    <>
      <div className="flex items-center border-b border-foreground/10 px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Menu size={18} />
          Menú
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <nav
        className={`fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col gap-1 overflow-y-auto border-r border-foreground/10 bg-background p-3 transition-transform duration-200 ease-in-out ${
          open ? "translate-x-0" : ""
        } md:static md:z-auto md:w-60 md:shrink-0 md:translate-x-0`}
      >
        <div className="mb-2 flex items-center justify-between md:hidden">
          <span className="text-sm font-semibold">Menú</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
            className="rounded-lg p-1 text-foreground/40 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>
        {links}
      </nav>
    </>
  );
}
