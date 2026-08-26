import "server-only";
import { Prisma, type Circuit, type Currency, type DocumentType, type EntityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";

const DUE_DATE_DAYS: Record<Circuit, number> = {
  NEGRO: 7,
  BLANCO: 15,
};

/** Vencimiento por defecto cuando no se carga uno manual: 7 días en Negro, 15 en Blanco. */
export function defaultDueDate(date: Date, circuit: Circuit): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + DUE_DATE_DAYS[circuit]);
  return result;
}

type DocumentWithRelations = Prisma.DocumentGetPayload<{
  include: {
    remitoLinks: true;
    allocations: true;
    lines: { include: { product: true } };
    purchaseLines: { include: { item: true } };
  };
}>;

const DOCUMENT_QUERY_INCLUDE = {
  remitoLinks: true,
  allocations: true,
  lines: { include: { product: true } },
  purchaseLines: { include: { item: true } },
} satisfies Prisma.DocumentInclude;

/**
 * Monto con signo que aporta un documento al saldo de la cuenta.
 * `remitoLinks` son los `DocumentLink` donde ESTE documento es el remito, cada uno con el monto
 * que absorbió una Factura puntual — se resta del total (facturación parcial: lo no facturado
 * sigue pendiente; si se facturó todo, el resultado es cero) para no duplicar saldo.
 */
export function getDocumentEffect(document: DocumentWithRelations): Prisma.Decimal {
  const total = toDecimal(document.totalAmount);

  switch (document.type as DocumentType) {
    case "AJUSTE":
      return total;
    case "NOTA_CREDITO":
      return total.negated();
    case "FACTURA":
    case "NOTA_DEBITO":
      return total;
    case "REMITO": {
      const invoiced = sumDecimals(document.remitoLinks.map((l) => l.amount));
      return total.minus(invoiced);
    }
    default:
      return ZERO;
  }
}

export function getDocumentPending(document: DocumentWithRelations): Prisma.Decimal {
  const effect = getDocumentEffect(document);
  const allocated = sumDecimals(document.allocations.map((a) => a.amount));
  return effect.minus(allocated);
}

export async function getAccountDocuments(accountId: string) {
  return prisma.document.findMany({
    where: { accountId },
    include: DOCUMENT_QUERY_INCLUDE,
    orderBy: { date: "asc" },
  });
}

export async function getAccountBalance(accountId: string): Promise<Prisma.Decimal> {
  const documents = await getAccountDocuments(accountId);
  return sumDecimals(documents.map((doc) => getDocumentPending(doc)));
}

export type PendingDocument = DocumentWithRelations & { pending: Prisma.Decimal };

export async function getPendingDocuments(
  accountId: string,
  currency?: Currency
): Promise<PendingDocument[]> {
  const documents = await getAccountDocuments(accountId);
  return documents
    .filter((doc) => !currency || doc.currency === currency)
    .map((doc) => ({ ...doc, pending: getDocumentPending(doc) }))
    .filter((doc) => !doc.pending.isZero());
}

export type FifoAllocation = { documentId: string; amount: Prisma.Decimal };

/** Imputa `amount` a los comprobantes pendientes más antiguos primero (FIFO). */
export async function allocateFifo(
  accountId: string,
  amount: Prisma.Decimal,
  currency: Currency
): Promise<FifoAllocation[]> {
  const pending = (await getPendingDocuments(accountId, currency)).filter((doc) =>
    doc.pending.greaterThan(0)
  );

  const result: FifoAllocation[] = [];
  let remaining = amount;

  for (const doc of pending) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const toApply = Prisma.Decimal.min(remaining, doc.pending);
    if (toApply.greaterThan(0)) {
      result.push({ documentId: doc.id, amount: toApply });
      remaining = remaining.minus(toApply);
    }
  }

  return result;
}

/** Comprobantes con vencimiento cargado y saldo pendiente > 0, para el listado de vencimientos. */
export async function getVencimientos() {
  const documents = await prisma.document.findMany({
    where: { dueDate: { not: null } },
    include: {
      ...DOCUMENT_QUERY_INCLUDE,
      account: { include: { entity: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  return documents
    .map((doc) => ({ ...doc, pending: getDocumentPending(doc) }))
    .filter((doc) => doc.pending.greaterThan(0));
}

export type InvoiceableRemito = DocumentWithRelations & { pending: Prisma.Decimal };

/** Remitos de una cuenta con saldo pendiente de facturar (total o parcial). */
export async function getInvoiceableRemitos(accountId: string): Promise<InvoiceableRemito[]> {
  const documents = await prisma.document.findMany({
    where: { accountId, type: "REMITO" },
    include: DOCUMENT_QUERY_INCLUDE,
    orderBy: { date: "asc" },
  });
  return documents
    .map((doc) => ({ ...doc, pending: getDocumentEffect(doc) }))
    .filter((doc) => doc.pending.greaterThan(0));
}

/** Remitos (entregas a clientes) más recientes, entre todas las entidades. */
export async function getRecentRemitos(limit = 30) {
  return prisma.document.findMany({
    where: { type: "REMITO", lines: { some: {} } },
    include: { ...DOCUMENT_QUERY_INCLUDE, account: { include: { entity: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });
}

/** Compras de insumos a proveedores más recientes, entre todas las entidades. */
export async function getRecentCompras(limit = 30) {
  return prisma.document.findMany({
    where: { type: "REMITO", purchaseLines: { some: {} } },
    include: { ...DOCUMENT_QUERY_INCLUDE, account: { include: { entity: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });
}

/** Pagos más recientes, filtrados por tipo de entidad (clientes o proveedores). */
export async function getRecentPayments(typeFilter: EntityType[], limit = 30) {
  return prisma.payment.findMany({
    where: { account: { entity: { type: { in: typeFilter } } } },
    include: { account: { include: { entity: true } }, allocations: { include: { document: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });
}

/** Saldo Blanco/Negro/Total por entidad, ordenado por mayor deuda. */
export async function getEntitySaldos(typeFilter?: EntityType[]) {
  const entities = await prisma.entity.findMany({
    where: typeFilter ? { type: { in: typeFilter } } : undefined,
    orderBy: { name: "asc" },
    include: { accounts: true },
  });

  const rows = await Promise.all(
    entities.map(async (entity) => {
      const blanco = entity.accounts.find((a) => a.circuit === "BLANCO");
      const negro = entity.accounts.find((a) => a.circuit === "NEGRO");
      const [blancoSaldo, negroSaldo] = await Promise.all([
        blanco ? getAccountBalance(blanco.id) : null,
        negro ? getAccountBalance(negro.id) : null,
      ]);
      const total = (blancoSaldo?.toNumber() ?? 0) + (negroSaldo?.toNumber() ?? 0);
      return { entity, blancoSaldo, negroSaldo, total };
    })
  );

  return rows.sort((a, b) => b.total - a.total);
}
