import "server-only";
import {
  Prisma,
  type DocumentType,
  type ExpenseCategory,
  type TaxKind,
  type TreasuryMovementCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/user-error";
import { circuitoDeTesoreria, esCaja } from "@/lib/pagos";

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
 * Lo que de una factura se recupera y por eso no es gasto: el IVA, que es crédito fiscal, y las
 * percepciones de IVA y de Ingresos Brutos, que se descuentan en sus declaraciones (Ian, 30/10/2026:
 * «se deberían recuperar, de eso se encarga el contador»). Lo no gravado, lo exento, las
 * contribuciones municipales y provinciales y los impuestos internos sí son gasto.
 */
const IMPUESTOS_RECUPERABLES: TaxKind[] = [
  "IVA",
  "PERCEPCION_IVA",
  "RG_3337",
  "PERCEPCION_IIBB",
  "PERCEPCION_IIBB_BSAS",
  "PERCEPCION_IIBB_CABA",
  "PERCEPCION_IIBB_SANTA_FE",
];

/**
 * Cuánto gastó de verdad un comprobante. Una factura de un proveedor, su total menos lo que se
 * recupera. Antes el reporte de Gastos sumaba el total con IVA y el resultado sólo el neto gravado,
 * que deja afuera lo no gravado del combustible y las contribuciones de Edenor: ninguno de los dos
 * era lo gastado. Lo de caja guarda el monto en `netAmount` (el total va con signo, porque en la caja
 * el total es lo que le hace al saldo).
 */
export function costoDelGasto(doc: {
  type: DocumentType;
  netAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  ivaAmount: Prisma.Decimal | null;
  taxes: { kind: TaxKind; amount: Prisma.Decimal }[];
}): Prisma.Decimal {
  if (doc.type !== "GASTO") return new Prisma.Decimal(doc.netAmount);
  const recuperable = doc.taxes
    .filter((t) => IMPUESTOS_RECUPERABLES.includes(t.kind))
    .reduce((acc, t) => acc.plus(t.amount), new Prisma.Decimal(0));
  // Uno viejo con el IVA en el comprobante y sin el desglose: se resta ese IVA.
  const sinDesglose = doc.taxes.length === 0 && doc.ivaAmount ? new Prisma.Decimal(doc.ivaAmount) : null;
  return new Prisma.Decimal(doc.totalAmount).minus(sinDesglose ?? recuperable);
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

/** Cualquier tesorería —Caja Bufano, el banco—, con la cuenta donde vive su plata. */
export async function getCajaPorId(id: string): Promise<CajaConCuenta> {
  const entity = await prisma.entity.findUnique({ where: { id }, include: { accounts: true } });
  const account = entity?.accounts.find((a) => a.circuit === circuitoDeTesoreria(entity.name));
  if (!entity || entity.type !== "TESORERIA" || !account) {
    throw new UserError("No se encontró la caja.");
  }
  return { id: entity.id, name: entity.name, slug: entity.slug, accountId: account.id };
}

/** Las otras cajas, para el pase: de dónde entró la plata o a dónde se la devolvió. */
export async function getOtrasCajas(excluirId: string): Promise<CajaConCuenta[]> {
  const entities = await prisma.entity.findMany({
    where: { type: "TESORERIA", id: { not: excluirId } },
    include: { accounts: true },
    orderBy: { name: "asc" },
  });
  // Cada una con su propia cuenta: el banco es Blanco y las cajas Negro. Antes se pedía la Negro de
  // todas, y la del banco no tiene nada, así que un pase con el banco se anotaba en una cuenta vacía.
  return entities
    .map((e) => ({ e, cuenta: e.accounts.find((a) => a.circuit === circuitoDeTesoreria(e.name)) }))
    .filter(({ cuenta }) => cuenta)
    .map(({ e, cuenta }) => ({ id: e.id, name: e.name, slug: e.slug, accountId: cuenta!.id }))
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
