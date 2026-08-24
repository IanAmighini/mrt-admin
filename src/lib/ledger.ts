import "server-only";
import { Prisma, type Currency, type DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";

type DocumentWithRelations = Prisma.DocumentGetPayload<{
  include: { remitoLinks: true; allocations: true };
}>;

const DOCUMENT_QUERY_INCLUDE = {
  remitoLinks: true,
  allocations: true,
} satisfies Prisma.DocumentInclude;

/**
 * Monto con signo que aporta un documento al saldo de la cuenta.
 * `remitoLinks` son los `DocumentLink` donde ESTE documento es el remito — si tiene alguno,
 * ya fue absorbido por una Factura y no debe sumar saldo por su cuenta (evita duplicarlo).
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
    case "REMITO":
      return document.remitoLinks.length > 0 ? ZERO : total;
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

/** Remitos de una cuenta que todavía no fueron absorbidos por ninguna Factura. */
export async function getUnlinkedRemitos(accountId: string) {
  const documents = await prisma.document.findMany({
    where: { accountId, type: "REMITO" },
    include: DOCUMENT_QUERY_INCLUDE,
    orderBy: { date: "asc" },
  });
  return documents.filter((doc) => doc.remitoLinks.length === 0);
}
