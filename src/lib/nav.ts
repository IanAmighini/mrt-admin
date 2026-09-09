import type { UserRole } from "@prisma/client";

export type NavItem = {
  href: string;
  label: string;
  roles: UserRole[];
  /**
   * Rutas que no son ítems del menú pero sí necesitan control de acceso. Están acá y no en una
   * lista aparte porque el middleware usa NAV_ITEMS como única fuente de permisos: una ruta que
   * falte en esta lista queda sin dueño, y antes eso significaba "la ve cualquiera" — así es como
   * /cuentas-corrientes quedó abierta hasta que existió un rol que no debía verla.
   */
  hidden?: boolean;
};

const ALL_ROLES: UserRole[] = ["ADMIN", "SOLO_LECTURA", "SECRETARIA", "ENCARGADO_PRODUCCION"];
/** El día a día administrativo: todo menos el encargado de producción, que solo mira su parte. */
const ADMINISTRATIVOS: UserRole[] = ["ADMIN", "SOLO_LECTURA", "SECRETARIA"];
/** Dashboards, Reportes y Tesorería — vistas gerenciales/financieras, no operativas. */
const GERENCIALES: UserRole[] = ["ADMIN", "SOLO_LECTURA"];

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inicio", roles: ALL_ROLES },
  { href: "/dashboard-clientes", label: "Dashboard Clientes", roles: GERENCIALES },
  { href: "/dashboard-proveedores", label: "Dashboard Proveedores", roles: GERENCIALES },
  { href: "/reportes", label: "Reportes", roles: GERENCIALES },
  { href: "/stock", label: "Stock", roles: ALL_ROLES },
  { href: "/clientes", label: "Clientes", roles: ADMINISTRATIVOS },
  { href: "/proveedores", label: "Proveedores", roles: ADMINISTRATIVOS },
  { href: "/pedidos", label: "Pedidos", roles: ALL_ROLES },
  { href: "/entregas", label: "Entregas", roles: ADMINISTRATIVOS },
  { href: "/compras", label: "Compras", roles: ADMINISTRATIVOS },
  { href: "/pagos-clientes", label: "Pagos de Clientes", roles: ADMINISTRATIVOS },
  { href: "/pagos-proveedores", label: "Pagos a Proveedores", roles: ADMINISTRATIVOS },
  { href: "/tesoreria", label: "Tesorería", roles: GERENCIALES },
  { href: "/produccion", label: "Producción", roles: ALL_ROLES },
  { href: "/usuarios", label: "Usuarios", roles: ["ADMIN"] },
  { href: "/actividad", label: "Actividad", roles: ["ADMIN"] },
  // Se llega desde Clientes y Proveedores, no desde el menú, pero muestra saldos y movimientos:
  // sin esta entrada el middleware la dejaba pasar a cualquiera con sesión.
  { href: "/cuentas-corrientes", label: "Cuenta corriente", roles: ADMINISTRATIVOS, hidden: true },
];

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  SOLO_LECTURA: "Solo lectura",
  SECRETARIA: "Secretaria",
  ENCARGADO_PRODUCCION: "Encargado de producción",
};

/** Los roles que se pueden asignar desde Usuarios, en el orden en que se muestran. */
export const ASSIGNABLE_ROLES: UserRole[] = [
  "ADMIN",
  "SECRETARIA",
  "ENCARGADO_PRODUCCION",
  "SOLO_LECTURA",
];

/** Los ítems que le corresponden a un rol en el menú lateral. */
export function navItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.hidden && item.roles.includes(role));
}
