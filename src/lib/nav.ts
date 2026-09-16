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
   *
   * `true` la esconde del menú para todos; una lista de roles, sólo para esos. Lo segundo es para
   * la ruta que cuelga de otra pantalla: quien llega por ahí no necesita el ítem, y quien no puede
   * ver esa pantalla sí.
   */
  hidden?: boolean | UserRole[];
  /**
   * Nombre del grupo con el que comparte lugar en el menú. Los ítems del mismo grupo se muestran
   * juntos, detrás de una sola entrada que se despliega. Es sólo presentación: los permisos los
   * sigue resolviendo cada ítem por su cuenta, y el middleware nunca ve el grupo.
   */
  group?: string;
};

/** Los grupos del menú, con el orden en que se despliegan adentro. */
export const NAV_GROUPS = {
  CAJA: "Caja y cheques",
  ADMINISTRACION: "Administración",
} as const;

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
  { href: "/compras", label: "Compras y gastos", roles: ADMINISTRATIVOS },
  { href: "/pagos-clientes", label: "Pagos de Clientes", roles: ADMINISTRATIVOS },
  { href: "/pagos-proveedores", label: "Pagos a Proveedores", roles: ADMINISTRATIVOS },
  // Los dos papeles que se emiten y se le entregan a alguien: la orden al proveedor, el libro al
  // contador. El libro queda fuera de Reportes, que es gerencial, porque la secretaría lo coteja
  // con ARCA antes de pasárselo al contador sin ver el resto de los reportes.
  {
    href: "/ordenes-pago",
    label: "Órdenes de pago",
    roles: ADMINISTRATIVOS,
    group: NAV_GROUPS.ADMINISTRACION,
  },
  { href: "/libro-iva", label: "Libro de IVA", roles: ADMINISTRATIVOS, group: NAV_GROUPS.ADMINISTRACION },
  { href: "/tesoreria", label: "Tesorería", roles: GERENCIALES },
  // Cuelga de Tesorería, igual que Cheques: quien ve Tesorería llega por la tarjeta de la caja y
  // tenerlo además en el menú es repetirlo. La secretaría no ve Tesorería —ahí están el banco y la
  // caja grande— pero la caja chica la maneja ella, así que a ella sí se le muestra.
  {
    href: "/caja-chica",
    label: "Caja chica",
    roles: ADMINISTRATIVOS,
    hidden: ["ADMIN", "SOLO_LECTURA"],
    group: NAV_GROUPS.CAJA,
  },
  // Cuelga de Tesorería, así que quien ve Tesorería llega por ahí y no necesita el ítem. La
  // secretaría no la ve pero igual tiene que poder marcar un cheque rechazado —a ella le avisan—
  // así que a ella sí se le muestra en el menú.
  {
    href: "/tesoreria/cheques",
    label: "Cheques",
    roles: ADMINISTRATIVOS,
    hidden: ["ADMIN", "SOLO_LECTURA"],
    group: NAV_GROUPS.CAJA,
  },
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

/**
 * Si un rol puede entrar a una ruta puntual, según la misma lista que arma el menú y que usa el
 * middleware. Sirve para las páginas que muestran cosas de otra sección: la cuenta corriente de una
 * tesorería es la misma pantalla que la de un cliente, pero lo que muestra es de Tesorería.
 */
export function puedeVerRuta(role: UserRole, href: string) {
  const item = NAV_ITEMS.find((i) => i.href === href);
  return item ? item.roles.includes(role) : false;
}

/** Una entrada del menú: un ítem suelto, o un grupo que se despliega con los suyos adentro. */
export type NavEntry = { kind: "item"; item: NavItem } | { kind: "group"; label: string; items: NavItem[] };

/**
 * El menú de un rol, con los grupos ya armados. Un grupo aparece donde está su primer ítem visible,
 * y si no le queda ninguno —Caja y cheques para el admin, que los ve desde Tesorería— no aparece.
 */
export function navEntriesForRole(role: UserRole): NavEntry[] {
  const entries: NavEntry[] = [];
  for (const item of navItemsForRole(role)) {
    if (!item.group) {
      entries.push({ kind: "item", item });
      continue;
    }
    const abierto = entries.find((e) => e.kind === "group" && e.label === item.group);
    if (abierto && abierto.kind === "group") abierto.items.push(item);
    else entries.push({ kind: "group", label: item.group, items: [item] });
  }
  return entries;
}

/** Los ítems que le corresponden a un rol en el menú lateral. */
export function navItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (!item.roles.includes(role)) return false;
    if (item.hidden === true) return false;
    if (Array.isArray(item.hidden)) return !item.hidden.includes(role);
    return true;
  });
}
