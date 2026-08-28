"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Building2,
  ClipboardList,
  Contact,
  Factory,
  Home,
  Package,
  Send,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
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
  "/produccion": Factory,
  "/usuarios": UserCog,
};

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-60 shrink-0 flex-col gap-1 border-r border-foreground/10 p-3">
      {items.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = ICONS_BY_HREF[item.href] ?? Home;
        return (
          <Link
            key={item.href}
            href={item.href}
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
      })}
    </nav>
  );
}
