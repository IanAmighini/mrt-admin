import "server-only";
import { Prisma, type Currency, type SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimals, toDecimal, ZERO } from "@/lib/money";
import { getEntitySaldos, getUltimaCotizacion, separarRetiroSocietario } from "@/lib/ledger";
import { getPagos, getValuacionInsumos } from "@/lib/dashboard-kpis";
import { getCobranzasReport, getComprasReport, getGastosReport, getVencidosReport, getVentasReport } from "@/lib/reports";
import { addDays, hoyComoFecha, periodLastDay, weekPeriod, type Period } from "@/lib/period";

/**
 * Los números de los dos dashboards. No calculan nada propio: salen de los mismos reportes que
 * Ventas, Cobranzas, Compras, Gastos y Comprobantes vencidos, así lo que dice un dashboard es lo que
 * se ve al abrir el reporte. Rehechos el 30/10/2026: antes "Entregas del mes" sumaba también los
 * insumos vendidos y el "margen" era otra cuenta que la del Cierre del mes.
 */

const pesos = (porMoneda: Map<Currency, Prisma.Decimal>) => porMoneda.get("ARS") ?? ZERO;
const SEMANAS = 8;

/** Las últimas semanas hasta el final del período (o hoy, si no terminó), de la más vieja a la más nueva. */
function semanasHasta(period: Period): Period[] {
  const hoy = hoyComoFecha();
  const ultimo = periodLastDay(period) < hoy ? periodLastDay(period) : hoy;
  const actual = weekPeriod(ultimo);
  return Array.from({ length: SEMANAS }, (_, i) => {
    const desde = addDays(actual.from, -7 * (SEMANAS - 1 - i));
    return { from: desde, to: addDays(desde, 7) };
  });
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export type TramoDeDeuda = { tramo: string; monto: Prisma.Decimal };

export async function getDashboardClientes(period: Period) {
  const semanas = semanasHasta(period);
  const [saldos, cotizacion, vencidos, ventas, cobranzas, ...porSemana] = await Promise.all([
    getEntitySaldos(["CLIENTE", "AMBOS"]),
    getUltimaCotizacion(),
    getVencidosReport(),
    getVentasReport(period),
    getCobranzasReport(period, "CLIENTES"),
    ...semanas.flatMap((s) => [getVentasReport(s), getCobranzasReport(s, "CLIENTES")]),
  ]);

  // Lo que nos deben hoy: sólo los que deben (un cliente con saldo a favor no achica lo que deben
  // los otros), con los dólares a la última cotización cargada.
  const enPesos = (f: (typeof saldos)[number]) =>
    new Prisma.Decimal(f.total).times(f.entity.moneda === "USD" && cotizacion ? cotizacion : 1);
  const deudores = saldos
    .filter((f) => f.total > 0)
    .map((f) => ({ nombre: f.entity.name, slug: f.entity.slug, total: enPesos(f) }))
    .sort((a, b) => b.total.comparedTo(a.total));
  const nosDeben = sumDecimals(deudores.map((d) => d.total));

  const vencidoPor = new Map(vencidos.porCliente.map((c) => [c.entitySlug, c.pendiente]));
  const tramo = (...nombres: string[]) =>
    sumDecimals(vencidos.porBucket.filter((b) => nombres.includes(b.bucket)).map((b) => b.pendiente));
  const vencido = pesos(vencidos.totalPendiente);
  const antiguedad: TramoDeDeuda[] = [
    { tramo: "No venció", monto: Prisma.Decimal.max(ZERO, nosDeben.minus(vencido)) },
    { tramo: "1 a 30 días", monto: tramo("1-15", "16-30") },
    { tramo: "31 a 60 días", monto: tramo("31-60") },
    { tramo: "Más de 60 días", monto: tramo("60+") },
    { tramo: "Anterior a la app", monto: tramo("Saldo inicial") },
  ];

  return {
    nosDeben,
    vencido,
    comprobantesVencidos: vencidos.rows.length,
    antiguedad,
    deudores: deudores.slice(0, 8).map((d) => ({ ...d, vencido: vencidoPor.get(d.slug) ?? ZERO })),
    cantidadDeudores: deudores.length,
    entregado: { pesos: pesos(ventas.totales.byCurrency), pallets: ventas.totales.pallets, litros: ventas.totales.litros },
    cobrado: pesos(cobranzas.totales),
    // Sin las semanas vacías del principio: las de antes de que arrancara la app no dicen nada.
    semanas: semanas
      .map((s, i) => ({
        desde: s.from,
        entregado: pesos((porSemana[i * 2] as Awaited<ReturnType<typeof getVentasReport>>).totales.byCurrency),
        cobrado: pesos((porSemana[i * 2 + 1] as Awaited<ReturnType<typeof getCobranzasReport>>).totales),
      }))
      .filter((s, i, todas) => todas.slice(0, i + 1).some((t) => !t.entregado.isZero() || !t.cobrado.isZero())),
    porMarca: ventas.porMarca
      .map((m) => ({ marca: m.marca, pallets: m.pallets, pesos: pesos(m.byCurrency) }))
      .filter((m) => !m.pesos.isZero())
      .sort((a, b) => b.pesos.comparedTo(a.pesos)),
  };
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

/** Una compra de aceite, con su precio llevado a U$S por tonelada (litros = kilos ÷ 0,92). */
export type PrecioDeAceite = { fecha: Date; aceite: string; proveedor: string; numero: string; usdPorTonelada: Prisma.Decimal };

const KILOS_POR_LITRO = new Prisma.Decimal("0.92");

/** Las compras de aceite de los últimos 90 días hasta el final del período, de la más vieja a la más nueva. */
async function getPreciosDeAceite(period: Period): Promise<PrecioDeAceite[]> {
  const hasta = period.to;
  const lineas = await prisma.purchaseLine.findMany({
    where: {
      item: { category: "ACEITE" },
      unitPrice: { gt: 0 },
      document: { date: { gte: addDays(hasta, -90), lt: hasta } },
    },
    select: {
      unitPrice: true,
      unitPriceUsd: true,
      item: { select: { name: true } },
      document: { select: { date: true, number: true, currency: true, exchangeRate: true, account: { select: { entity: { select: { name: true } } } } } },
    },
    orderBy: [{ document: { date: "asc" } }, { document: { createdAt: "asc" } }],
  });
  const filas: PrecioDeAceite[] = [];
  for (const l of lineas) {
    const doc = l.document;
    const usdPorLitro =
      doc.currency === "USD"
        ? toDecimal(l.unitPrice)
        : l.unitPriceUsd ?? (doc.exchangeRate ? toDecimal(l.unitPrice).dividedBy(doc.exchangeRate) : null);
    if (!usdPorLitro) continue;
    filas.push({
      fecha: doc.date,
      aceite: l.item.name.replace(/^Aceite /, ""),
      proveedor: doc.account.entity.name,
      numero: doc.number,
      usdPorTonelada: usdPorLitro.dividedBy(KILOS_POR_LITRO).times(1000).toDecimalPlaces(0),
    });
  }
  return filas;
}

export async function getDashboardProveedores(period: Period) {
  const [saldos, cotizacion, compras, gastos, pagos, valuacion, aceite] = await Promise.all([
    getEntitySaldos(["PROVEEDOR", "AMBOS"]),
    getUltimaCotizacion(),
    getComprasReport(period),
    getGastosReport(period),
    getPagos(["PROVEEDOR", "AMBOS"], period),
    // Con las planchas de cartón, que todavía no llevan stock: Ian las quiere acá (29/10/2026).
    getValuacionInsumos(),
    getPreciosDeAceite(period),
  ]);

  const { deuda, retiros } = separarRetiroSocietario(saldos);
  const aPesos = (n: Prisma.Decimal | number | null | undefined, moneda: Currency) =>
    toDecimal(n ?? 0).times(moneda === "USD" && cotizacion ? cotizacion : 1);
  const acreedores = deuda
    .filter((f) => f.total > 0)
    .map((f) => ({
      nombre: f.entity.name,
      slug: f.entity.slug,
      total: aPesos(f.total, f.entity.moneda),
      // Lo que va a cada cuenta; un saldo a favor en una de las dos no se dibuja.
      cuenta1: Prisma.Decimal.max(ZERO, aPesos(f.blancoSaldo, f.entity.moneda)),
      cuenta2: Prisma.Decimal.max(ZERO, aPesos(f.negroSaldo, f.entity.moneda)),
    }))
    .sort((a, b) => b.total.comparedTo(a.total));

  const stockPorCategoria = new Map<SupplierCategory, Prisma.Decimal>();
  for (const { item, valuacion: v } of valuacion.rows) {
    if (!v || v.isZero()) continue;
    stockPorCategoria.set(item.category, (stockPorCategoria.get(item.category) ?? ZERO).plus(v));
  }

  return {
    lesDebemos: sumDecimals(acreedores.map((a) => a.total)),
    acreedores: acreedores.slice(0, 8),
    cantidadAcreedores: acreedores.length,
    comprado: pesos(compras.totales),
    gastado: sumDecimals(gastos.porRubro.map((r) => pesos(r.byCurrency))),
    pagado: pesos(pagos),
    compradoPorTipo: compras.porCategoria
      .map((c) => ({ categoria: c.category, pesos: pesos(c.byCurrency) }))
      .filter((c) => c.pesos.greaterThan(0))
      .sort((a, b) => b.pesos.comparedTo(a.pesos)),
    aceite,
    stock: valuacion.total,
    stockPorCategoria: Array.from(stockPorCategoria.entries())
      .map(([categoria, valor]) => ({ categoria, valor }))
      .sort((a, b) => b.valor.comparedTo(a.valor)),
    retiros,
  };
}
