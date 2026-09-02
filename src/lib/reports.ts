import "server-only";
import {
  Prisma,
  type Circuit,
  type Currency,
  type DocumentType,
  type PaymentMethod,
  type SupplierCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { getVencimientos, litrosDeLinea } from "@/lib/ledger";
import { getCostoInsumos } from "@/lib/dashboard-kpis";
import { formatProductBrandLabel, formatProductLabel } from "@/lib/product-label";
import type { Period } from "@/lib/period";

export const REPORT_KEYS = [
  "remitos-vencidos",
  "ventas",
  "cobranzas",
  "compras",
  "produccion",
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_LABELS: Record<ReportKey, string> = {
  "remitos-vencidos": "Remitos vencidos",
  ventas: "Ventas / entregas",
  cobranzas: "Cobranzas y pagos",
  compras: "Compras de insumos",
  produccion: "Producción",
};

export function isReportKey(value: string | undefined): value is ReportKey {
  return REPORT_KEYS.includes(value as ReportKey);
}

/** Suma `amount` en el mapa por moneda (los importes nunca se mezclan entre monedas). */
function addByCurrency(map: Map<Currency, Prisma.Decimal>, currency: Currency, amount: Prisma.Decimal) {
  map.set(currency, (map.get(currency) ?? ZERO).plus(amount));
}

// ---------------------------------------------------------------------------
// 1. Remitos vencidos impagos — "a hoy", no lleva período
// ---------------------------------------------------------------------------

export const VENCIDO_BUCKETS = ["1-15", "16-30", "31-60", "60+"] as const;
export type VencidoBucket = (typeof VENCIDO_BUCKETS)[number];

function bucketDe(dias: number): VencidoBucket {
  if (dias <= 15) return "1-15";
  if (dias <= 30) return "16-30";
  if (dias <= 60) return "31-60";
  return "60+";
}

export type VencidoRow = {
  documentId: string;
  type: DocumentType;
  entityName: string;
  entitySlug: string;
  circuit: Circuit;
  number: string;
  date: Date;
  dueDate: Date;
  diasAtraso: number;
  bucket: VencidoBucket;
  currency: Currency;
  total: Prisma.Decimal;
  pendiente: Prisma.Decimal;
};

export type VencidosReport = {
  asOf: Date;
  rows: VencidoRow[];
  totalPendiente: Map<Currency, Prisma.Decimal>;
  porCliente: { entityName: string; entitySlug: string; count: number; pendiente: Prisma.Decimal }[];
  porBucket: { bucket: VencidoBucket; count: number; pendiente: Prisma.Decimal }[];
  clientesAfectados: number;
  atrasoMaximo: number;
};

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Comprobantes vencidos con saldo pendiente. Incluye remitos y facturas a propósito: cuando un
 * remito se factura, `getDocumentEffect` lo deja en cero y la deuda pasa a vivir en la factura, así
 * que mirar solo remitos escondería casi toda la deuda de los clientes que facturan.
 */
export async function getVencidosReport(options?: {
  asOf?: Date;
  circuit?: Circuit;
}): Promise<VencidosReport> {
  const asOf = options?.asOf ?? new Date();
  const vencimientos = await getVencimientos();

  const rows: VencidoRow[] = [];
  for (const doc of vencimientos) {
    if (!doc.dueDate || doc.dueDate >= asOf) continue;
    if (doc.account.entity.type === "TESORERIA") continue;
    if (options?.circuit && doc.account.circuit !== options.circuit) continue;

    const diasAtraso = Math.floor((asOf.getTime() - doc.dueDate.getTime()) / MS_POR_DIA);
    rows.push({
      documentId: doc.id,
      type: doc.type,
      entityName: doc.account.entity.name,
      entitySlug: doc.account.entity.slug,
      circuit: doc.account.circuit,
      number: doc.number,
      date: doc.date,
      dueDate: doc.dueDate,
      diasAtraso,
      bucket: bucketDe(diasAtraso),
      currency: doc.currency,
      total: doc.totalAmount,
      pendiente: doc.pending,
    });
  }

  rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  const totalPendiente = new Map<Currency, Prisma.Decimal>();
  const porClienteMap = new Map<string, { entityName: string; entitySlug: string; count: number; pendiente: Prisma.Decimal }>();
  const porBucketMap = new Map<VencidoBucket, { bucket: VencidoBucket; count: number; pendiente: Prisma.Decimal }>();

  for (const row of rows) {
    addByCurrency(totalPendiente, row.currency, row.pendiente);

    const cliente = porClienteMap.get(row.entitySlug) ?? {
      entityName: row.entityName,
      entitySlug: row.entitySlug,
      count: 0,
      pendiente: ZERO,
    };
    cliente.count++;
    cliente.pendiente = cliente.pendiente.plus(row.pendiente);
    porClienteMap.set(row.entitySlug, cliente);

    const bucket = porBucketMap.get(row.bucket) ?? { bucket: row.bucket, count: 0, pendiente: ZERO };
    bucket.count++;
    bucket.pendiente = bucket.pendiente.plus(row.pendiente);
    porBucketMap.set(row.bucket, bucket);
  }

  return {
    asOf,
    rows,
    totalPendiente,
    porCliente: Array.from(porClienteMap.values()).sort((a, b) => b.pendiente.comparedTo(a.pendiente)),
    porBucket: VENCIDO_BUCKETS.map(
      (bucket) => porBucketMap.get(bucket) ?? { bucket, count: 0, pendiente: ZERO }
    ),
    clientesAfectados: porClienteMap.size,
    atrasoMaximo: rows.length > 0 ? Math.max(...rows.map((r) => r.diasAtraso)) : 0,
  };
}

// ---------------------------------------------------------------------------
// 2. Ventas / entregas del período
// ---------------------------------------------------------------------------

type VentasAgg = { pallets: Prisma.Decimal; litros: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> };

function emptyAgg(): VentasAgg {
  return { pallets: ZERO, litros: ZERO, byCurrency: new Map() };
}

export type VentasReport = {
  period: Period;
  porCliente: (VentasAgg & { entityName: string; entitySlug: string })[];
  porMarca: (VentasAgg & { marca: string })[];
  porProducto: (VentasAgg & { productSlug: string; label: string })[];
  detalle: {
    number: string;
    date: Date;
    entityName: string;
    circuit: Circuit;
    productLabel: string;
    pallets: Prisma.Decimal;
    litros: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    currency: Currency;
  }[];
  totales: VentasAgg;
  porCircuito: Record<Circuit, VentasAgg>;
};

/**
 * Entregas a clientes del período, abiertas por cliente, marca y producto. Se miran solo los
 * REMITOs (las facturas duplicarían lo mismo, porque facturan remitos ya contados acá).
 */
export async function getVentasReport(
  period: Period,
  options?: { circuit?: Circuit }
): Promise<VentasReport> {
  const documents = await prisma.document.findMany({
    where: {
      type: "REMITO",
      lines: { some: {} },
      date: { gte: period.from, lt: period.to },
      account: {
        entity: { type: { in: ["CLIENTE", "AMBOS"] } },
        ...(options?.circuit ? { circuit: options.circuit } : {}),
      },
    },
    include: {
      account: { include: { entity: true } },
      lines: { include: { product: { include: { recipe: { include: { item: true } } } } } },
    },
    orderBy: { date: "asc" },
  });

  const porCliente = new Map<string, VentasAgg & { entityName: string; entitySlug: string }>();
  const porMarca = new Map<string, VentasAgg & { marca: string }>();
  const porProducto = new Map<string, VentasAgg & { productSlug: string; label: string }>();
  const porCircuito: Record<Circuit, VentasAgg> = { BLANCO: emptyAgg(), NEGRO: emptyAgg() };
  const totales = emptyAgg();
  const detalle: VentasReport["detalle"] = [];

  function accumulate(agg: VentasAgg, pallets: Prisma.Decimal, litros: Prisma.Decimal, currency: Currency, amount: Prisma.Decimal) {
    agg.pallets = agg.pallets.plus(pallets);
    agg.litros = agg.litros.plus(litros);
    addByCurrency(agg.byCurrency, currency, amount);
  }

  for (const doc of documents) {
    const { entity, circuit } = doc.account;
    for (const line of doc.lines) {
      const pallets = toDecimal(line.quantity);
      const litros = litrosDeLinea(line);
      const marca = formatProductBrandLabel(line.product);

      const cliente = porCliente.get(entity.slug) ?? { ...emptyAgg(), entityName: entity.name, entitySlug: entity.slug };
      accumulate(cliente, pallets, litros, doc.currency, line.subtotal);
      porCliente.set(entity.slug, cliente);

      const marcaAgg = porMarca.get(marca) ?? { ...emptyAgg(), marca };
      accumulate(marcaAgg, pallets, litros, doc.currency, line.subtotal);
      porMarca.set(marca, marcaAgg);

      const producto = porProducto.get(line.product.slug) ?? {
        ...emptyAgg(),
        productSlug: line.product.slug,
        label: formatProductLabel(line.product),
      };
      accumulate(producto, pallets, litros, doc.currency, line.subtotal);
      porProducto.set(line.product.slug, producto);

      accumulate(porCircuito[circuit], pallets, litros, doc.currency, line.subtotal);
      accumulate(totales, pallets, litros, doc.currency, line.subtotal);

      detalle.push({
        number: doc.number,
        date: doc.date,
        entityName: entity.name,
        circuit,
        productLabel: formatProductLabel(line.product),
        pallets,
        litros,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        currency: doc.currency,
      });
    }
  }

  const byPallets = <T extends { pallets: Prisma.Decimal }>(a: T, b: T) => b.pallets.comparedTo(a.pallets);

  return {
    period,
    porCliente: Array.from(porCliente.values()).sort(byPallets),
    porMarca: Array.from(porMarca.values()).sort(byPallets),
    porProducto: Array.from(porProducto.values()).sort(byPallets),
    detalle,
    totales,
    porCircuito,
  };
}

// ---------------------------------------------------------------------------
// 3. Cobranzas y pagos del período
// ---------------------------------------------------------------------------

export type CobranzasLado = "CLIENTES" | "PROVEEDORES";

export type CobranzasReport = {
  period: Period;
  lado: CobranzasLado;
  rows: {
    date: Date;
    entityName: string;
    entitySlug: string;
    circuit: Circuit;
    method: PaymentMethod;
    currency: Currency;
    amount: Prisma.Decimal;
    reference: string | null;
    tesoreria: string | null;
    sinImputar: Prisma.Decimal;
  }[];
  porMetodo: { method: PaymentMethod; count: number; byCurrency: Map<Currency, Prisma.Decimal> }[];
  porEntidad: { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }[];
  totales: Map<Currency, Prisma.Decimal>;
};

export async function getCobranzasReport(period: Period, lado: CobranzasLado): Promise<CobranzasReport> {
  const payments = await prisma.payment.findMany({
    where: {
      date: { gte: period.from, lt: period.to },
      account: {
        entity: { type: { in: lado === "CLIENTES" ? ["CLIENTE", "AMBOS"] : ["PROVEEDOR", "AMBOS"] } },
      },
    },
    include: { account: { include: { entity: true } }, allocations: true, treasury: true },
    orderBy: { date: "asc" },
  });

  const porMetodo = new Map<PaymentMethod, { method: PaymentMethod; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porEntidad = new Map<string, { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const totales = new Map<Currency, Prisma.Decimal>();

  const rows = payments.map((payment) => {
    const { entity, circuit } = payment.account;
    const imputado = sumDecimals(payment.allocations.map((a) => a.amount));

    const metodo = porMetodo.get(payment.method) ?? { method: payment.method, count: 0, byCurrency: new Map() };
    metodo.count++;
    addByCurrency(metodo.byCurrency, payment.currency, payment.amount);
    porMetodo.set(payment.method, metodo);

    const entidad = porEntidad.get(entity.slug) ?? {
      entityName: entity.name,
      entitySlug: entity.slug,
      count: 0,
      byCurrency: new Map(),
    };
    entidad.count++;
    addByCurrency(entidad.byCurrency, payment.currency, payment.amount);
    porEntidad.set(entity.slug, entidad);

    addByCurrency(totales, payment.currency, payment.amount);

    return {
      date: payment.date,
      entityName: entity.name,
      entitySlug: entity.slug,
      circuit,
      method: payment.method,
      currency: payment.currency,
      amount: payment.amount,
      reference: payment.reference,
      tesoreria: payment.treasury?.name ?? null,
      sinImputar: payment.amount.minus(imputado),
    };
  });

  const byArs = (a: { byCurrency: Map<Currency, Prisma.Decimal> }, b: { byCurrency: Map<Currency, Prisma.Decimal> }) =>
    (b.byCurrency.get("ARS") ?? ZERO).comparedTo(a.byCurrency.get("ARS") ?? ZERO);

  return {
    period,
    lado,
    rows,
    porMetodo: Array.from(porMetodo.values()).sort(byArs),
    porEntidad: Array.from(porEntidad.values()).sort(byArs),
    totales,
  };
}

// ---------------------------------------------------------------------------
// 4. Compras de insumos del período
// ---------------------------------------------------------------------------

export type ComprasReport = {
  period: Period;
  porProveedor: { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }[];
  porCategoria: { category: SupplierCategory; byCurrency: Map<Currency, Prisma.Decimal>; qtyByUnit: Map<string, Prisma.Decimal> }[];
  porInsumo: { itemSlug: string; itemName: string; unit: string; quantity: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }[];
  detalle: {
    number: string;
    date: Date;
    entityName: string;
    circuit: Circuit;
    itemName: string;
    quantity: Prisma.Decimal;
    unit: string;
    unitPrice: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    currency: Currency;
  }[];
  totales: Map<Currency, Prisma.Decimal>;
};

export async function getComprasReport(period: Period): Promise<ComprasReport> {
  const documents = await prisma.document.findMany({
    where: {
      type: "REMITO",
      purchaseLines: { some: {} },
      date: { gte: period.from, lt: period.to },
    },
    include: {
      account: { include: { entity: true } },
      purchaseLines: { include: { item: true } },
    },
    orderBy: { date: "asc" },
  });

  const porProveedor = new Map<string, { entityName: string; entitySlug: string; count: number; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const porCategoria = new Map<SupplierCategory, { category: SupplierCategory; byCurrency: Map<Currency, Prisma.Decimal>; qtyByUnit: Map<string, Prisma.Decimal> }>();
  const porInsumo = new Map<string, { itemSlug: string; itemName: string; unit: string; quantity: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }>();
  const totales = new Map<Currency, Prisma.Decimal>();
  const detalle: ComprasReport["detalle"] = [];

  for (const doc of documents) {
    const { entity, circuit } = doc.account;

    const proveedor = porProveedor.get(entity.slug) ?? {
      entityName: entity.name,
      entitySlug: entity.slug,
      count: 0,
      byCurrency: new Map(),
    };
    proveedor.count++;

    for (const line of doc.purchaseLines) {
      const quantity = toDecimal(line.quantity);
      addByCurrency(proveedor.byCurrency, doc.currency, line.subtotal);

      const categoria = porCategoria.get(line.item.category) ?? {
        category: line.item.category,
        byCurrency: new Map(),
        qtyByUnit: new Map(),
      };
      addByCurrency(categoria.byCurrency, doc.currency, line.subtotal);
      categoria.qtyByUnit.set(line.item.unit, (categoria.qtyByUnit.get(line.item.unit) ?? ZERO).plus(quantity));
      porCategoria.set(line.item.category, categoria);

      const insumo = porInsumo.get(line.item.slug) ?? {
        itemSlug: line.item.slug,
        itemName: line.item.name,
        unit: line.item.unit,
        quantity: ZERO,
        byCurrency: new Map(),
      };
      insumo.quantity = insumo.quantity.plus(quantity);
      addByCurrency(insumo.byCurrency, doc.currency, line.subtotal);
      porInsumo.set(line.item.slug, insumo);

      addByCurrency(totales, doc.currency, line.subtotal);

      detalle.push({
        number: doc.number,
        date: doc.date,
        entityName: entity.name,
        circuit,
        itemName: line.item.name,
        quantity,
        unit: line.item.unit,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        currency: doc.currency,
      });
    }

    porProveedor.set(entity.slug, proveedor);
  }

  const byArs = (a: { byCurrency: Map<Currency, Prisma.Decimal> }, b: { byCurrency: Map<Currency, Prisma.Decimal> }) =>
    (b.byCurrency.get("ARS") ?? ZERO).comparedTo(a.byCurrency.get("ARS") ?? ZERO);

  return {
    period,
    porProveedor: Array.from(porProveedor.values()).sort(byArs),
    porCategoria: Array.from(porCategoria.values()).sort(byArs),
    porInsumo: Array.from(porInsumo.values()).sort(byArs),
    detalle,
    totales,
  };
}

// ---------------------------------------------------------------------------
// 5. Producción del período
// ---------------------------------------------------------------------------

export type ProduccionReport = {
  period: Period;
  porProducto: {
    productSlug: string;
    label: string;
    pallets: Prisma.Decimal;
    botellas: Prisma.Decimal;
  }[];
  corridas: { date: Date; notes: string | null; lines: { label: string; pallets: Prisma.Decimal }[] }[];
  litrosEnvasados: Prisma.Decimal;
  costoInsumos: Awaited<ReturnType<typeof getCostoInsumos>>;
  totalPallets: Prisma.Decimal;
};

export async function getProduccionReport(period: Period): Promise<ProduccionReport> {
  const [runs, costoInsumos] = await Promise.all([
    prisma.productionRun.findMany({
      where: { date: { gte: period.from, lt: period.to } },
      include: { lines: { include: { product: true } } },
      orderBy: { date: "asc" },
    }),
    getCostoInsumos(period),
  ]);

  const porProducto = new Map<string, { productSlug: string; label: string; pallets: Prisma.Decimal; botellas: Prisma.Decimal }>();
  let totalPallets = ZERO;

  for (const run of runs) {
    for (const line of run.lines) {
      const pallets = toDecimal(line.quantity);
      const porPallet = (line.product.boxesPerPallet ?? 0) * (line.product.unitsPerBox ?? 0);
      const current = porProducto.get(line.product.slug) ?? {
        productSlug: line.product.slug,
        label: formatProductLabel(line.product),
        pallets: ZERO,
        botellas: ZERO,
      };
      current.pallets = current.pallets.plus(pallets);
      current.botellas = current.botellas.plus(pallets.times(porPallet));
      porProducto.set(line.product.slug, current);
      totalPallets = totalPallets.plus(pallets);
    }
  }

  // Litros envasados = aceite consumido en el período (los insumos medidos en "L").
  const litrosEnvasados = sumDecimals(
    costoInsumos.porItem.filter((r) => r.item.unit === "L").map((r) => r.cantidad)
  );

  return {
    period,
    porProducto: Array.from(porProducto.values()).sort((a, b) => b.pallets.comparedTo(a.pallets)),
    corridas: runs.map((run) => ({
      date: run.date,
      notes: run.notes,
      lines: run.lines.map((l) => ({ label: formatProductLabel(l.product), pallets: toDecimal(l.quantity) })),
    })),
    litrosEnvasados,
    costoInsumos,
    totalPallets,
  };
}
