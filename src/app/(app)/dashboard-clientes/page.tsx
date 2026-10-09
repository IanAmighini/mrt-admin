import Link from "next/link";
import { formatFecha } from "@/lib/period";
import { Droplets, Send, Users, Wallet } from "lucide-react";
import type { Currency, Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import {
  getEntitySaldos,
  getRecentPayments,
  getRecentRemitos,
  getUltimaCotizacion,
  sumarSaldosEnPesos,
} from "@/lib/ledger";
import {
  getIngresos,
  getLitrosEnvasados,
  getPagos,
  getProductoEntregadoValorizado,
  getRentabilidad,
} from "@/lib/dashboard-kpis";
import { formatMoney, formatQuantity, sumDecimals, ZERO } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { Renglon, Tarjeta } from "@/components/ui/Tarjeta";
import { getVencidosReport } from "@/lib/reports";
import { formatLineasDeRemito } from "@/lib/product-label";

export default async function DashboardClientesPage() {
  const user = await requireRole(["ADMIN", "SOLO_LECTURA"]);
  const isAdmin = user.role === "ADMIN";

  const [entregas, pagos, saldos, vencidos, ingresosDelMes, pagosDelMes, litros, cotizacion] = await Promise.all([
    getRecentRemitos(6),
    getRecentPayments(["CLIENTE", "AMBOS"], 6),
    getEntitySaldos(["CLIENTE", "AMBOS"]),
    // La misma lista que el Inicio y el reporte de Comprobantes vencidos.
    getVencidosReport(),
    getIngresos(),
    getPagos(["CLIENTE", "AMBOS"]),
    getLitrosEnvasados(),
    getUltimaCotizacion(),
  ]);

  // Hay clientes que llevan la cuenta en dólares, así que sumar los saldos crudos daría un número
  // sin sentido. Se valuán con la última cotización que alguien usó de verdad en la app —en un
  // pago o en un comprobante— y no con una que haya que mantener aparte y se olvide de
  // actualizar. Mismo criterio que el dashboard de proveedores.
  const { total: deudaTotal, dolaresSinValuar } = sumarSaldosEnPesos(saldos, cotizacion);
  const hayCuentasEnDolares = saldos.some((s) => s.entity.moneda === "USD");
  const ingresosArs = ingresosDelMes.get("ARS") ?? ZERO;
  const cobrosArs = pagosDelMes.get("ARS") ?? ZERO;

  // Quiénes más deben, por el total de las dos cuentas: sólo los que deben algo, y los de dólares
  // valuados para poder ordenarlos contra los de pesos.
  const enPesos = (f: (typeof saldos)[number]) => (f.entity.moneda === "USD" && cotizacion ? f.total * cotizacion.toNumber() : f.total);
  const conDeuda = saldos.filter((f) => f.total > 0).sort((a, b) => enPesos(b) - enPesos(a));
  const vencidosArs = sumDecimals(vencidos.rows.filter((r) => r.currency === "ARS").map((r) => r.pendiente));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Dashboard Clientes</h1>
        <p className="text-sm text-foreground/60">
          Lo que nos deben, lo vencido y lo último que entró y salió.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Deuda total de clientes"
          value={
            dolaresSinValuar.isZero()
              ? formatMoney(deudaTotal)
              : `${formatMoney(deudaTotal)} + ${formatMoney(dolaresSinValuar, "USD")}`
          }
          caption={
            hayCuentasEnDolares && cotizacion
              ? `dólares valuados a ${formatMoney(cotizacion)}`
              : undefined
          }
          icon={Users}
          color="red"
        />
        <KpiCard label="Entregas del mes" value={formatMoney(ingresosArs)} icon={Send} color="blue" />
        <KpiCard label="Cobros del mes" value={formatMoney(cobrosArs)} icon={Wallet} color="green" />
        <KpiCard
          label="Litros envasados (este mes)"
          value={formatQuantity(litros.enPeriodo, "L")}
          icon={Droplets}
          color="amber"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Tarjeta
          titulo="Comprobantes vencidos"
          resumen={
            vencidos.rows.length === 0
              ? "Nadie tiene comprobantes vencidos."
              : `${vencidos.rows.length} ${vencidos.rows.length === 1 ? "comprobante" : "comprobantes"} · ${formatMoney(vencidosArs)}`
          }
          href="/reportes?report=remitos-vencidos"
          alerta={vencidos.rows.length > 0}
        >
          {vencidos.rows.slice(0, 6).map((r) => (
            <Renglon
              key={r.documentId}
              izquierda={r.saldoInicial ? `${r.entityName} · saldo inicial` : `${r.entityName} · #${r.number}`}
              debajo={
                r.saldoInicial
                  ? "Deuda anterior a la app"
                  : `Venció el ${formatFecha(r.dueDate)} · ${r.diasAtraso} ${r.diasAtraso === 1 ? "día" : "días"}`
              }
              derecha={formatMoney(r.pendiente, r.currency)}
              href={`/cuentas-corrientes/${r.entitySlug}`}
            />
          ))}
        </Tarjeta>

        <Tarjeta
          titulo="Los que más deben"
          resumen={
            conDeuda.length === 0
              ? "Ningún cliente debe nada."
              : `${conDeuda.length} ${conDeuda.length === 1 ? "cliente" : "clientes"} con deuda`
          }
          href="/clientes?saldo=deuda"
        >
          {conDeuda.slice(0, 6).map((f) => (
            <Renglon
              key={f.entity.id}
              izquierda={f.entity.name}
              debajo={[
                f.blancoSaldo && !f.blancoSaldo.isZero() ? `Cuenta 1 ${formatMoney(f.blancoSaldo, f.entity.moneda)}` : null,
                f.negroSaldo && !f.negroSaldo.isZero() ? `Cuenta 2 ${formatMoney(f.negroSaldo, f.entity.moneda)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              derecha={formatMoney(f.total, f.entity.moneda)}
              href={`/cuentas-corrientes/${f.entity.slug}`}
            />
          ))}
        </Tarjeta>

        <Tarjeta titulo="Últimas entregas" href="/entregas">
          {entregas.map((doc) => (
            <Renglon
              key={doc.id}
              izquierda={`${doc.account.entity.name} · #${doc.number}`}
              debajo={`${formatFecha(doc.date)} · ${formatLineasDeRemito(doc.lines)}`}
              derecha={formatMoney(doc.totalAmount, doc.currency)}
              href={`/cuentas-corrientes/${doc.account.entity.slug}`}
            />
          ))}
          {entregas.length === 0 && <p className="py-2 text-sm text-foreground/40">Todavía no hay entregas cargadas.</p>}
        </Tarjeta>

        <Tarjeta titulo="Últimos cobros" href="/pagos-clientes">
          {pagos.map((p) => (
            <Renglon
              key={p.id}
              izquierda={p.account.entity.name}
              debajo={`${formatFecha(p.date)} · ${PAYMENT_METHOD_LABELS[p.method]}`}
              derecha={formatMoney(p.amount, p.currency)}
              href={`/cuentas-corrientes/${p.account.entity.slug}`}
            />
          ))}
          {pagos.length === 0 && <p className="py-2 text-sm text-foreground/40">Todavía no hay cobros cargados.</p>}
        </Tarjeta>
      </div>

      {isAdmin && <ReportesGerenciales />}
    </div>
  );
}

async function ReportesGerenciales() {
  const [rentabilidad, entregado] = await Promise.all([getRentabilidad(), getProductoEntregadoValorizado()]);

  const porMarca = new Map<string, { quantity: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }>();
  for (const { product, quantity, byCurrency } of entregado) {
    const marca = formatProductBrandLabel(product);
    const current = porMarca.get(marca) ?? { quantity: ZERO, byCurrency: new Map<Currency, Prisma.Decimal>() };
    current.quantity = current.quantity.plus(quantity);
    for (const [currency, amount] of byCurrency) {
      const currentAmount = current.byCurrency.get(currency) ?? ZERO;
      current.byCurrency.set(currency, currentAmount.plus(amount));
    }
    porMarca.set(marca, current);
  }
  const marcas = Array.from(porMarca.entries()).sort((a, b) =>
    sumDecimals(Array.from(b[1].byCurrency.values())).comparedTo(sumDecimals(Array.from(a[1].byCurrency.values())))
  );

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Reportes gerenciales</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm font-semibold mb-1">Margen del mes</p>
          <p
            className={`text-2xl font-semibold ${
              rentabilidad.rentabilidad.lessThan(0) ? "text-red-600 dark:text-red-400" : ""
            }`}
          >
            {formatMoney(rentabilidad.rentabilidad)}
          </p>
          {/* De dónde sale: un margen suelto no se puede discutir, tres renglones sí. */}
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground/60">Ventas</span>
              <span className="tabular-nums">{formatMoney(rentabilidad.ingresos)}</span>
            </div>
            {rentabilidad.ventasDeInsumos.cantidad > 0 && (
              <div className="flex justify-between text-xs text-foreground/50">
                <span>incluye venta de insumos</span>
                <span className="tabular-nums">{formatMoney(rentabilidad.ventasDeInsumos.ventas)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-foreground/60">− Insumos</span>
              <span className="tabular-nums">{formatMoney(rentabilidad.costoInsumos)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground/60">− Gastos</span>
              <span className="tabular-nums">{formatMoney(rentabilidad.gastos)}</span>
            </div>
          </div>
          <p className="text-xs text-foreground/50 mt-2">
            Todo en pesos y neto de IVA. Los sueldos y lo que sale de la caja chica ya están
            adentro. <Link href="/reportes?report=resultado" className="underline underline-offset-2">
            Ver el mes a mes</Link>.
            {rentabilidad.itemsSinCosto > 0 &&
              ` Ojo: ${rentabilidad.itemsSinCosto} insumo(s) consumido(s) no tienen costo unitario cargado, así que no se descontaron.`}
          </p>
          {rentabilidad.facturasSinCompra.count > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
              Hay {rentabilidad.facturasSinCompra.count} factura(s) de proveedor por{" "}
              {formatMoney(rentabilidad.facturasSinCompra.total)} sin una compra vinculada, así que
              ese costo no está descontado acá.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm font-semibold mb-1">Producto entregado valorizado (este mes), por marca</p>
          <div className="mt-2 space-y-1">
            {marcas.map(([marca, { quantity, byCurrency }]) => (
              <div key={marca} className="flex items-center justify-between text-sm border-b border-foreground/5 py-1">
                <span>
                  {marca} <span className="text-foreground/50">— {formatQuantity(quantity)}</span>
                </span>
                <span className="font-medium">
                  {Array.from(byCurrency.entries())
                    .map(([currency, amount]) => formatMoney(amount, currency))
                    .join(" + ")}
                </span>
              </div>
            ))}
            {marcas.length === 0 && (
              <p className="py-2 text-sm text-foreground/40">Sin remitos con producto y cantidad cargados este mes.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
