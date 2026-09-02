import Link from "next/link";
import { Droplets, Send, Users, Wallet } from "lucide-react";
import type { Currency, Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import {
  getEntitySaldos,
  getRecentPayments,
  getRecentRemitos,
  getVencimientos,
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
import { TopDeudaSection } from "@/components/TopDeudaSection";

export default async function DashboardClientesPage() {
  const user = await requireRole(["ADMIN", "SOLO_LECTURA"]);
  const isAdmin = user.role === "ADMIN";
  const today = new Date();

  const [entregas, pagos, saldos, vencimientos, ingresosDelMes, pagosDelMes, litros] = await Promise.all([
    getRecentRemitos(5),
    getRecentPayments(["CLIENTE", "AMBOS"], 5),
    getEntitySaldos(["CLIENTE", "AMBOS"]),
    getVencimientos(),
    getIngresos(),
    getPagos(["CLIENTE", "AMBOS"]),
    getLitrosEnvasados(),
  ]);

  const remitosVencidos = vencimientos.filter(
    (doc) =>
      doc.type === "REMITO" &&
      ["CLIENTE", "AMBOS"].includes(doc.account.entity.type) &&
      doc.dueDate! < today
  );

  const deudaTotal = sumDecimals(saldos.map((s) => s.total));
  const ingresosArs = ingresosDelMes.get("ARS") ?? ZERO;
  const cobrosArs = pagosDelMes.get("ARS") ?? ZERO;

  const topBlanco = [...saldos]
    .sort((a, b) => (b.blancoSaldo?.toNumber() ?? 0) - (a.blancoSaldo?.toNumber() ?? 0))
    .slice(0, 5);
  const topNegro = [...saldos]
    .sort((a, b) => (b.negroSaldo?.toNumber() ?? 0) - (a.negroSaldo?.toNumber() ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Dashboard Clientes</h1>
        <p className="text-sm text-foreground/60">
          Últimas entregas, remitos vencidos, últimos pagos y clientes con más deuda.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Deuda total de clientes" value={formatMoney(deudaTotal)} icon={Users} color="red" />
        <KpiCard label="Entregas del mes" value={formatMoney(ingresosArs)} icon={Send} color="blue" />
        <KpiCard label="Cobros del mes" value={formatMoney(cobrosArs)} icon={Wallet} color="green" />
        <KpiCard
          label="Litros envasados (este mes)"
          value={formatQuantity(litros.enPeriodo, "L")}
          icon={Droplets}
          color="amber"
        />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Remitos vencidos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Cliente</th>
                <th className="py-2 pr-4">Remito</th>
                <th className="py-2 pr-4">Vencimiento</th>
                <th className="py-2 pr-4">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {remitosVencidos.map((doc) => (
                <tr key={doc.id} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/cuentas-corrientes/${doc.account.entity.slug}`}
                      className="underline underline-offset-2"
                    >
                      {doc.account.entity.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">#{doc.number}</td>
                  <td className="py-2 pr-4 text-red-600 dark:text-red-400 font-medium">
                    {doc.dueDate?.toLocaleDateString("es-AR")}
                  </td>
                  <td className="py-2 pr-4">{formatMoney(doc.pending, doc.currency)}</td>
                </tr>
              ))}
              {remitosVencidos.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-foreground/40">
                    No hay remitos vencidos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold mb-2">Últimas entregas</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">Remito</th>
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {entregas.map((doc) => (
                  <tr key={doc.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${doc.account.entity.slug}`}
                        className="underline underline-offset-2"
                      >
                        {doc.account.entity.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">#{doc.number}</td>
                    <td className="py-2 pr-4">{doc.date.toLocaleDateString("es-AR")}</td>
                    <td className="py-2 pr-4">{formatMoney(doc.totalAmount, doc.currency)}</td>
                  </tr>
                ))}
                {entregas.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-foreground/40">
                      Todavía no hay entregas cargadas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-2">Últimos pagos</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">Monto</th>
                  <th className="py-2 pr-4">Medio</th>
                  <th className="py-2 pr-4">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {pagos.map((payment) => (
                  <tr key={payment.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${payment.account.entity.slug}`}
                        className="underline underline-offset-2"
                      >
                        {payment.account.entity.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{formatMoney(payment.amount, payment.currency)}</td>
                    <td className="py-2 pr-4">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                    <td className="py-2 pr-4">{payment.date.toLocaleDateString("es-AR")}</td>
                  </tr>
                ))}
                {pagos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-foreground/40">
                      Todavía no hay pagos cargados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <TopDeudaSection
          title="Clientes con más deuda — Cuenta Blanco"
          rows={topBlanco}
          circuit="blanco"
          entityNoun="Cliente"
          emptyMessage="Todavía no hay clientes cargados."
        />
        <TopDeudaSection
          title="Clientes con más deuda — Cuenta Negro"
          rows={topNegro}
          circuit="negro"
          entityNoun="Cliente"
          emptyMessage="Todavía no hay clientes cargados."
        />
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
          <p className="text-sm font-semibold mb-1">Rentabilidad del mes</p>
          <p className="text-2xl font-semibold">{formatMoney(rentabilidad.rentabilidad)}</p>
          <p className="text-xs text-foreground/50 mt-1">
            ingresos (ARS) menos costo de insumos consumidos en producción. No incluye otros
            costos fijos (mano de obra, alquiler, etc.)
            {rentabilidad.itemsSinCosto > 0 &&
              ` — ${rentabilidad.itemsSinCosto} insumo(s) consumido(s) sin costo unitario cargado, no se descontaron.`}
          </p>
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
