import "server-only";
import {
  Prisma,
  type Circuit,
  type Currency,
  type DocumentType,
  type EntityType,
  type ExpenseCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/labels";

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

export type DocumentWithRelations = Prisma.DocumentGetPayload<{
  include: {
    remitoLinks: { include: { factura: { select: { id: true; number: true; date: true } } } };
    allocations: true;
    lines: { include: { product: true } };
    purchaseLines: { include: { item: true } };
    taxes: true;
  };
}>;

const DOCUMENT_QUERY_INCLUDE = {
  // Con la factura adentro: una compra necesita poder mostrar cuál la cubre, no sólo que lo está.
  remitoLinks: { include: { factura: { select: { id: true, number: true, date: true } } } },
  allocations: true,
  lines: { include: { product: true } },
  purchaseLines: { include: { item: true } },
  // El desglose impositivo de un GASTO: lo necesita el formulario de edición para prellenarse.
  taxes: true,
} satisfies Prisma.DocumentInclude;

/**
 * Monto con signo que aporta un documento al saldo de la cuenta.
 * `remitoLinks` son los `DocumentLink` donde ESTE documento es el remito, cada uno con el monto
 * que absorbió una Factura puntual — se resta del total (facturación parcial: lo no facturado
 * sigue pendiente; si se facturó todo, el resultado es cero) para no duplicar saldo.
 */
export function getDocumentEffect(
  // Solo lo que realmente lee, y estructural en vez de `Pick<DocumentWithRelations, …>`: así sirve
  // igual desde una consulta que trae menos de cada link, o más.
  document: {
    type: DocumentType;
    totalAmount: Prisma.Decimal;
    remitoLinks: { amount: Prisma.Decimal }[];
  }
): Prisma.Decimal {
  const total = toDecimal(document.totalAmount);

  switch (document.type as DocumentType) {
    case "AJUSTE":
      return total;
    case "NOTA_CREDITO":
      return total.negated();
    case "FACTURA":
    case "NOTA_DEBITO":
    // Un gasto suma lo que se le debe al proveedor, igual que una factura.
    case "GASTO":
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

/**
 * Saldo = lo pendiente de cobrar por documentos, menos lo que un cliente ya pagó y todavía no se
 * imputó a ningún comprobante (pagó de más, o pagó antes de que existiera el documento). Ese
 * sobrante es un crédito a favor del cliente — sin restarlo, la plata "desaparecía" y el saldo
 * podía marcar $0 incluso debiéndole al cliente.
 */
export async function getAccountBalance(accountId: string): Promise<Prisma.Decimal> {
  const [documents, payments] = await Promise.all([
    getAccountDocuments(accountId),
    prisma.payment.findMany({ where: { accountId }, include: { allocations: true } }),
  ]);

  const pendingTotal = sumDecimals(documents.map((doc) => getDocumentPending(doc)));
  const unallocatedTotal = sumDecimals(
    payments.map((p) => p.amount.minus(sumDecimals(p.allocations.map((a) => a.amount))))
  );

  return pendingTotal.minus(unallocatedTotal);
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

/** Remitos (entregas a clientes) más recientes, entre todas las entidades o de una sola. */
export async function getRecentRemitos(limit = 30, entityId?: string, search?: string) {
  const trimmedSearch = search?.trim();
  return prisma.document.findMany({
    where: {
      type: "REMITO",
      lines: { some: {} },
      ...(entityId ? { account: { entityId } } : {}),
      ...(trimmedSearch
        ? {
            OR: [
              { number: { contains: trimmedSearch, mode: "insensitive" } },
              { account: { entity: { name: { contains: trimmedSearch, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: { ...DOCUMENT_QUERY_INCLUDE, account: { include: { entity: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });
}

/** Compras de insumos a proveedores más recientes, entre todas las entidades o de una sola. */
export async function getRecentCompras(limit = 30, entityId?: string, search?: string) {
  const trimmedSearch = search?.trim();
  return prisma.document.findMany({
    where: {
      type: "REMITO",
      purchaseLines: { some: {} },
      ...(entityId ? { account: { entityId } } : {}),
      ...(trimmedSearch
        ? {
            OR: [
              { number: { contains: trimmedSearch, mode: "insensitive" } },
              { account: { entity: { name: { contains: trimmedSearch, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: { ...DOCUMENT_QUERY_INCLUDE, account: { include: { entity: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });
}

/** Facturas de gasto: lo que se le compra a un proveedor y no es un insumo — flete, alquiler, luz. */
export async function getRecentGastos(limit = 30, entityId?: string, search?: string) {
  const trimmedSearch = search?.trim();
  // El rubro es un enum, así que buscar "flete" no lo encontraría por más que la fila lo muestre:
  // se traduce el texto a las categorías cuya etiqueta lo contenga.
  const rubros = trimmedSearch
    ? (Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).filter((c) =>
        EXPENSE_CATEGORY_LABELS[c].toLowerCase().includes(trimmedSearch.toLowerCase())
      )
    : [];

  return prisma.document.findMany({
    where: {
      type: "GASTO",
      ...(entityId ? { account: { entityId } } : {}),
      ...(trimmedSearch
        ? {
            OR: [
              { number: { contains: trimmedSearch, mode: "insensitive" } },
              { reason: { contains: trimmedSearch, mode: "insensitive" } },
              { account: { entity: { name: { contains: trimmedSearch, mode: "insensitive" } } } },
              ...(rubros.length > 0 ? [{ expenseCategory: { in: rubros } }] : []),
            ],
          }
        : {}),
    },
    include: { ...DOCUMENT_QUERY_INCLUDE, account: { include: { entity: true } } },
    orderBy: { date: "desc" },
    take: limit,
  });
}

/** Litros entregados a un cliente: cantidad de la línea (pallets) × litros de aceite por pallet
 * según la receta del producto (RecipeItem.quantityPerUnit ya está expresado por pallet armado,
 * no por botella). Ignora líneas de productos sin receta de aceite o sin cajas/pallet y
 * botellas/caja cargados. */
export type LineWithRecipe = Prisma.DocumentLineGetPayload<{
  include: { product: { include: { recipe: { include: { item: true } } } } };
}>;

/**
 * Litros de aceite que representa una línea de remito: pallets × los litros por pallet que dice
 * la receta del producto (el insumo medido en "L"). Cero si al producto le falta la presentación
 * o no tiene aceite en la receta. Única definición de "litros entregados" en la app.
 */
export function litrosDeLinea(line: LineWithRecipe): Prisma.Decimal {
  const { product } = line;
  if (!product.boxesPerPallet || !product.unitsPerBox) return ZERO;
  const oilRecipe = product.recipe.find((r) => r.item.unit === "L");
  if (!oilRecipe) return ZERO;
  return toDecimal(line.quantity).times(oilRecipe.quantityPerUnit);
}

export async function getLitrosEntregados(entityId: string): Promise<Prisma.Decimal> {
  const documents = await prisma.document.findMany({
    where: { type: "REMITO", account: { entityId }, lines: { some: {} } },
    include: {
      lines: {
        include: {
          product: { include: { recipe: { include: { item: true } } } },
        },
      },
    },
  });

  return sumDecimals(documents.flatMap((doc) => doc.lines.map(litrosDeLinea)));
}

/** Cantidad de remitos (entregas) distintos de una entidad — una compra/entrega mixta
 * Blanco+Negro comparte número entre 2 filas de Document, se cuenta como una sola. */
export async function getEntregasCount(entityId: string): Promise<number> {
  const documents = await prisma.document.findMany({
    where: { type: "REMITO", account: { entityId }, lines: { some: {} } },
    select: { number: true },
  });
  return new Set(documents.map((d) => d.number)).size;
}

export type ComprasSummary = {
  count: number;
  totalByUnit: Map<string, Prisma.Decimal>;
};

/** Cantidad de compras distintas de un proveedor, y cantidad total entregada agrupada por
 * unidad de insumo (para mostrar un número único cuando el proveedor siempre trae lo mismo). */
export async function getComprasSummary(entityId: string): Promise<ComprasSummary> {
  const documents = await prisma.document.findMany({
    where: { type: "REMITO", account: { entityId }, purchaseLines: { some: {} } },
    include: { purchaseLines: { include: { item: true } } },
  });

  const totalByUnit = new Map<string, Prisma.Decimal>();
  for (const doc of documents) {
    for (const line of doc.purchaseLines) {
      const current = totalByUnit.get(line.item.unit) ?? ZERO;
      totalByUnit.set(line.item.unit, current.plus(line.quantity));
    }
  }

  return { count: new Set(documents.map((d) => d.number)).size, totalByUnit };
}

export type RecentMovement =
  | { kind: "document"; date: Date; document: DocumentWithRelations }
  | { kind: "payment"; date: Date; payment: Prisma.PaymentGetPayload<{ include: { allocations: true } }> };

/** Documentos y pagos mezclados de las dos cuentas de una entidad, para el panel de actividad
 * reciente de la ficha individual (sin saldo acumulado — eso es de la tabla de movimientos). */
export async function getRecentMovementsForEntity(
  entityId: string,
  limit = 8
): Promise<RecentMovement[]> {
  const accounts = await prisma.account.findMany({ where: { entityId } });
  const accountIds = accounts.map((a) => a.id);

  const [documents, payments] = await Promise.all([
    prisma.document.findMany({
      where: { accountId: { in: accountIds } },
      include: DOCUMENT_QUERY_INCLUDE,
    }),
    prisma.payment.findMany({
      where: { accountId: { in: accountIds } },
      include: { allocations: true },
    }),
  ]);

  const movements: RecentMovement[] = [
    ...documents.map((document) => ({ kind: "document" as const, date: document.date, document })),
    ...payments.map((payment) => ({ kind: "payment" as const, date: payment.date, payment })),
  ];

  return movements.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);
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

  // Alfabético, que es como se busca a alguien en una lista. Con `localeCompare("es")` para que la
  // ñ y los acentos caigan donde corresponde, y no después de la z como haría un orden por bytes.
  // Los dashboards no dependen de esto: reordenan por saldo para armar sus top 5.
  return rows.sort((a, b) => a.entity.name.localeCompare(b.entity.name, "es"));
}

/** Las entidades TESORERIA (Banco Galicia, Caja Bufano), con sus dos cuentas — para el selector
 * de destino/origen de pagos y para la página /tesoreria. */
export async function getTreasuries() {
  return prisma.entity.findMany({
    where: { type: "TESORERIA" },
    orderBy: { name: "asc" },
    include: { accounts: true },
  });
}

/**
 * La última cotización del dólar que se cargó en la app, mirando pagos y comprobantes.
 *
 * Sirve para valuar en pesos los saldos de las cuentas que se llevan en dólares, sin obligar a
 * mantener un número aparte que se olvidaría de actualizar: la cotización sale de la última vez que
 * alguien la usó de verdad. Devuelve `null` si todavía no se cargó ninguna, y ahí lo que
 * corresponde es mostrar los dólares aparte en vez de inventar una conversión.
 */
export async function getUltimaCotizacion(): Promise<Prisma.Decimal | null> {
  const [pago, documento] = await Promise.all([
    prisma.payment.findFirst({
      where: { exchangeRate: { not: null } },
      orderBy: { date: "desc" },
      select: { exchangeRate: true, date: true },
    }),
    prisma.document.findFirst({
      where: { exchangeRate: { not: null } },
      orderBy: { date: "desc" },
      select: { exchangeRate: true, date: true },
    }),
  ]);
  if (!pago && !documento) return null;
  if (!pago) return documento!.exchangeRate;
  if (!documento) return pago.exchangeRate;
  return pago.date >= documento.date ? pago.exchangeRate : documento.exchangeRate;
}

/**
 * Suma saldos de cuentas que pueden estar en monedas distintas, valuando los dólares con la última
 * cotización cargada. Sumarlos crudos daría un número sin sentido.
 */
/**
 * Aparta el saldo a favor de la cuenta por la que se retira plata para los socios.
 *
 * Ese saldo no es un crédito con el proveedor —no nos va a entregar mercadería por eso— así que
 * sumarlo a la deuda la subestima, y de paso esconde cuánto se retiró. Sólo se aparta cuando la
 * cuenta está a favor nuestro: si se le debe, es deuda como la de cualquier otro.
 */
export function separarRetiroSocietario<
  T extends { entity: { moneda: Currency; retiroSocietario: boolean; name: string }; total: number },
>(filas: T[]): { deuda: T[]; retiros: { nombre: string; monto: Prisma.Decimal; moneda: Currency }[] } {
  const deuda: T[] = [];
  const retiros: { nombre: string; monto: Prisma.Decimal; moneda: Currency }[] = [];
  for (const fila of filas) {
    if (fila.entity.retiroSocietario && fila.total < 0) {
      retiros.push({
        nombre: fila.entity.name,
        monto: new Prisma.Decimal(-fila.total),
        moneda: fila.entity.moneda,
      });
      continue;
    }
    deuda.push(fila);
  }
  return { deuda, retiros };
}

/**
 * Saldo de unas cuentas a una fecha (exclusiva): lo que sumaron los comprobantes menos lo pagado,
 * contando sólo lo anterior al corte. `null` = hasta hoy.
 */
async function saldoAlCorte(accountIds: string[], corte: Date | null): Promise<Prisma.Decimal> {
  const fecha = corte ? { date: { lt: corte } } : {};
  const [documentos, pagos] = await Promise.all([
    prisma.document.findMany({
      where: { accountId: { in: accountIds }, ...fecha },
      select: { type: true, totalAmount: true, remitoLinks: { select: { amount: true } } },
    }),
    prisma.payment.findMany({
      where: { accountId: { in: accountIds }, ...fecha },
      select: { amount: true },
    }),
  ]);
  return sumDecimals(documentos.map(getDocumentEffect)).minus(sumDecimals(pagos.map((p) => p.amount)));
}

/** Lo que la cuenta está a favor nuestro, o cero si se le debe. */
const aFavor = (saldo: Prisma.Decimal) => (saldo.lessThan(0) ? saldo.negated() : ZERO);

/**
 * Cuánto se retiró para los socios **en el período**, por la cuenta marcada para eso.
 *
 * Es cuánto creció el saldo a favor entre el principio y el fin: el acumulado sirve para el saldo
 * de hoy, pero en un reporte mensual repetiría todos los meses lo que ya se había retirado antes.
 * Y se mide sobre el saldo a favor y no sobre los pagos del mes, porque lo que se le paga de lo que
 * sí debíamos es una deuda que se cancela, no un retiro.
 */
export async function getRetirosDelPeriodo(period: { from: Date; to: Date }) {
  const entities = await prisma.entity.findMany({
    where: { retiroSocietario: true },
    include: { accounts: { select: { id: true } } },
  });

  return Promise.all(
    entities.map(async (entity) => {
      const ids = entity.accounts.map((a) => a.id);
      const [inicio, cierre] = await Promise.all([
        saldoAlCorte(ids, period.from),
        saldoAlCorte(ids, period.to),
      ]);
      return {
        nombre: entity.name,
        moneda: entity.moneda,
        delPeriodo: aFavor(cierre).minus(aFavor(inicio)),
        acumulado: aFavor(cierre),
      };
    })
  );
}

export function sumarSaldosEnPesos(
  filas: { entity: { moneda: Currency }; total: number }[],
  cotizacion: Prisma.Decimal | null
): { total: Prisma.Decimal; dolaresSinValuar: Prisma.Decimal } {
  let pesos = ZERO;
  let dolares = ZERO;
  for (const f of filas) {
    if (f.entity.moneda === "USD") dolares = dolares.plus(f.total);
    else pesos = pesos.plus(f.total);
  }
  return cotizacion
    ? { total: pesos.plus(dolares.times(cotizacion)), dolaresSinValuar: ZERO }
    : { total: pesos, dolaresSinValuar: dolares };
}

/**
 * Para la ficha de un proveedor que no compra insumos: cuánto se le gastó en lo que va del año y
 * cuándo fue la última vez que hubo algo en su cuenta. En uno de servicios, "Compras 0" e "Insumo
 * entregado 0" no dicen nada; esto sí.
 */
export async function getResumenDeGastos(entityId: string) {
  const desde = new Date(new Date().getFullYear(), 0, 1);

  const [gastos, ultimoDoc, ultimoPago] = await Promise.all([
    prisma.document.findMany({
      where: { type: "GASTO", account: { entityId }, date: { gte: desde } },
      select: { netAmount: true },
    }),
    prisma.document.findFirst({
      where: { account: { entityId } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.payment.findFirst({
      where: { account: { entityId } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);

  const fechas = [ultimoDoc?.date, ultimoPago?.date].filter((d): d is Date => Boolean(d));
  return {
    delAnio: sumDecimals(gastos.map((g) => g.netAmount)),
    ultimoMovimiento: fechas.length > 0 ? new Date(Math.max(...fechas.map((d) => d.getTime()))) : null,
  };
}
