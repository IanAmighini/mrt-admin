"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Banknote,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Coins,
  Contact,
  Factory,
  FileSpreadsheet,
  FileText,
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
import { NAV_GROUPS, type NavEntry, type NavItem } from "@/lib/nav";

const ICONS_BY_GROUP: Record<string, LucideIcon> = {
  [NAV_GROUPS.CAJA]: Coins,
  [NAV_GROUPS.ADMINISTRACION]: FileText,
};

const ICONS_BY_HREF: Record<string, LucideIcon> = {
  "/": Home,
  "/dashboard-clientes": Users,
  "/dashboard-proveedores": Truck,
  "/reportes": FileSpreadsheet,
  "/stock": Package,
  "/clientes": Contact,
  "/proveedores": Building2,
  "/pedidos": ClipboardList,
  "/entregas": Send,
  "/compras": ShoppingCart,
  "/pagos-clientes": Wallet,
  "/pagos-proveedores": Banknote,
  "/tesoreria": Landmark,
  "/ordenes-pago": FileText,
  "/libro-iva": FileSpreadsheet,
  "/caja-chica": Coins,
  "/tesoreria/cheques": Banknote,
  "/produccion": Factory,
  "/usuarios": UserCog,
  "/actividad": History,
};

const filaClass = "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";
const filaActiva = "bg-primary text-primary-foreground font-medium";
const filaQuieta = "text-foreground/70 hover:bg-foreground/5 hover:text-foreground";

export function SidebarNav({ entries }: { entries: NavEntry[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Qué grupos abrió o cerró el usuario a mano. Sin entrada acá, un grupo está abierto sólo si la
  // página que se está mirando es una de las suyas: el sentido de agruparlos era acortar el menú.
  const [desplegados, setDesplegados] = useState<Record<string, boolean>>({});

  const esActiva = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const link = (item: NavItem, dentroDeGrupo = false) => {
    const Icon = ICONS_BY_HREF[item.href] ?? Home;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setOpen(false)}
        className={`${filaClass} ${esActiva(item.href) ? filaActiva : filaQuieta}`}
      >
        <Icon size={dentroDeGrupo ? 15 : 17} strokeWidth={2} className="shrink-0" />
        {item.label}
      </Link>
    );
  };

  const links = entries.map((entry) => {
    if (entry.kind === "item") return link(entry.item);

    const tieneActiva = entry.items.some((i) => esActiva(i.href));
    const abierto = desplegados[entry.label] ?? tieneActiva;
    const Icon = ICONS_BY_GROUP[entry.label] ?? Home;
    return (
      <div key={entry.label} className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setDesplegados((d) => ({ ...d, [entry.label]: !abierto }))}
          aria-expanded={abierto}
          className={`${filaClass} ${tieneActiva && !abierto ? filaActiva : filaQuieta}`}
        >
          <Icon size={17} strokeWidth={2} className="shrink-0" />
          {entry.label}
          {abierto ? (
            <ChevronDown size={15} className="ml-auto shrink-0 opacity-50" />
          ) : (
            <ChevronRight size={15} className="ml-auto shrink-0 opacity-50" />
          )}
        </button>
        {abierto && (
          <div className="ml-4 flex flex-col gap-1 border-l border-foreground/10 pl-2">
            {entry.items.map((i) => link(i, true))}
          </div>
        )}
      </div>
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
