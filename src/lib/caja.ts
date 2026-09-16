import "server-only";
import type {
  DocumentType,
  ExpenseCategory,
  Prisma,
  TreasuryMovementCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/user-error";
import { esCaja } from "@/lib/pagos";

/**
 * La caja chica: la que maneja la secretaría para los sueldos y los gastos del día. La plata sale
 * de la caja grande y llega acá con un pase.
 *
 * Es una tesorería más y no una categoría de la caja grande porque lleva su propio saldo, que es
 * contra lo que se cuenta el efectivo del cajón. El resto de la app —cobros, pagos, el libro
 * mayor, el Excel— la trata como a cualquier otra.
 */
export const CAJA_CHICA_SLUG = "caja-chica";

/** De la caja chica sólo se usa la cuenta en Negro: no se elige circuito al cargar un movimiento. */
export const CIRCUITO_DE_CAJA = "NEGRO" as const;

/**
 * Los dos gastos que existen: la factura de un proveedor y lo que sale de la caja sin factura.
 * Van juntos en el margen y en el reporte de gastos — la plata sale igual, y hasta ahora lo de la
 * caja no aparecía en ningún lado.
 */
export const GASTOS_WHERE: Prisma.DocumentWhereInput = {
  OR: [
    { type: "GASTO" },
    // Los de caja, más los impuestos y las comisiones del banco cargados como movimiento: es plata
    // que sale igual, y sin esto el monotributo contaba o no según si lo cargó ella en la caja o
    // vos en el banco. El signo es la guarda: un depósito o un retiro no son gasto, y un
    // movimiento cargado como "suma al saldo" tampoco.
    {
      treasuryCategory: { in: ["GASTO", "IMPUESTO", "GASTO_BANCARIO"] },
      totalAmount: { lt: 0 },
    },
  ],
};

/**
 * El rubro con el que se muestra un gasto. Los movimientos de tesorería viejos no tienen rubro
 * propio, pero su categoría ya dice de qué son.
 */
export function rubroDelGasto(doc: {
  expenseCategory: ExpenseCategory | null;
  treasuryCategory: TreasuryMovementCategory | null;
}): ExpenseCategory | null {
  if (doc.expenseCategory) return doc.expenseCategory;
  if (doc.treasuryCategory === "IMPUESTO") return "IMPUESTOS";
  if (doc.treasuryCategory === "GASTO_BANCARIO") return "BANCARIOS";
  return null;
}

/**
 * Cuánto gastó un comprobante. El de un proveedor gasta su total (con IVA y percepciones); el de
 * caja guarda el monto en `netAmount` y el total con signo negativo, porque en la caja el total es
 * lo que le hace al saldo.
 */
export function montoDelGasto(doc: {
  type: DocumentType;
  netAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}) {
  return doc.type === "GASTO" ? doc.totalAmount : doc.netAmount;
}

export type CajaConCuenta = {
  id: string;
  name: string;
  slug: string;
  accountId: string;
};

async function cajaPorSlug(slug: string): Promise<CajaConCuenta> {
  const entity = await prisma.entity.findUnique({
    where: { slug },
    include: { accounts: { where: { circuit: CIRCUITO_DE_CAJA } } },
  });
  const account = entity?.accounts[0];
  if (!entity || entity.type !== "TESORERIA" || !account) {
    throw new UserError("No se encontró la caja.");
  }
  return { id: entity.id, name: entity.name, slug: entity.slug, accountId: account.id };
}

export function getCajaChica() {
  return cajaPorSlug(CAJA_CHICA_SLUG);
}

/** Las otras cajas, para el pase: de dónde entró la plata o a dónde se la devolvió. */
export async function getOtrasCajas(excluirId: string): Promise<CajaConCuenta[]> {
  const entities = await prisma.entity.findMany({
    where: { type: "TESORERIA", id: { not: excluirId } },
    include: { accounts: { where: { circuit: CIRCUITO_DE_CAJA } } },
    orderBy: { name: "asc" },
  });
  return entities
    .filter((e) => e.accounts[0])
    .map((e) => ({ id: e.id, name: e.name, slug: e.slug, accountId: e.accounts[0].id }))
    // Las cajas primero: el pase es casi siempre con la caja grande, y el banco quedaba arriba sólo
    // por orden alfabético, así que la opción preseleccionada era la equivocada.
    .sort((a, b) => Number(esCaja(b.name)) - Number(esCaja(a.name)) || a.name.localeCompare(b.name, "es"));
}

/**
 * El número que le toca al próximo movimiento de esta caja. Los movimientos de caja no tienen
 * comprobante —nadie da factura por el remís— así que el número lo pone la app: sirve para
 * nombrarlos en el libro mayor y en la auditoría.
 */
export async function proximoNumeroDeCaja(tx: Prisma.TransactionClient, accountId: string) {
  const ultimo = await tx.document.findFirst({
    where: { accountId, number: { startsWith: "CAJA-" } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = ultimo ? Number(ultimo.number.slice(5)) + 1 : 1;
  return `CAJA-${String(n).padStart(5, "0")}`;
}
