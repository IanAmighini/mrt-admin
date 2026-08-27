import type { UserRole } from "@prisma/client";

export type NavItem = {
  href: string;
  label: string;
  roles: UserRole[];
};

const ALL_ROLES: UserRole[] = ["ADMIN", "CARGA_DIARIA", "SOLO_LECTURA"];

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", roles: ALL_ROLES },
  { href: "/dashboard-clientes", label: "Dashboard Clientes", roles: ALL_ROLES },
  { href: "/dashboard-proveedores", label: "Dashboard Proveedores", roles: ALL_ROLES },
  { href: "/stock", label: "Stock", roles: ALL_ROLES },
  { href: "/clientes", label: "Clientes", roles: ALL_ROLES },
  { href: "/proveedores", label: "Proveedores", roles: ALL_ROLES },
  { href: "/entregas", label: "Entregas", roles: ALL_ROLES },
  { href: "/compras", label: "Compras", roles: ALL_ROLES },
  { href: "/pagos-clientes", label: "Pagos de Clientes", roles: ALL_ROLES },
  { href: "/pagos-proveedores", label: "Pagos a Proveedores", roles: ALL_ROLES },
  { href: "/produccion", label: "Producción", roles: ALL_ROLES },
  { href: "/usuarios", label: "Usuarios", roles: ["ADMIN"] },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  CARGA_DIARIA: "Carga diaria",
  SOLO_LECTURA: "Solo lectura",
};
