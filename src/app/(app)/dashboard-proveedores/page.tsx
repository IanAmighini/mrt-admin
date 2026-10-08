import { formatFecha } from "@/lib/period";
import { Banknote, Building2, HandCoins, Package, ShoppingCart } from "lucide-react";
import type { Prisma, Currency } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import {
  getEntitySaldos,
  getRecentCompras,
  getRecentPayments,
  getUltimaCotizacion,
  separarRetiroSocietario,
  sumarSaldosEnPesos,
} from "@/lib/ledger";
import {
  getCompras,
  getCostoInsumos,
  getPagos,
  getValuacionInsumos,
} from "@/lib/dashboard-kpis";
import { formatMoney, ZERO } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { Renglon, Tarjeta } from "@/components/ui/Tarjeta";

function primaryAndExtra(map: Map<Currency, Prisma.Decimal>) {
  const ars = map.get("ARS") ?? ZERO;
  const otras = Array.from(map.entries()).filter(([currency]) => currency !== "ARS");
  return {
    primary: formatMoney(ars, "ARS"),
    extra: otras.length > 0 ? otras.map(([currency, amount]) => formatMoney(amount, currency)).join(" + ") : undefined,
  };
}

export default async function DashboardProveedoresPage() {
  const user = await requireRole(["ADMIN", "SOLO_LECTURA"]);
  const isAdmin = user.role === "ADMIN";

  const [compras, pagos, saldos, comprasDelMes, pagosDelMes, valuacion, cotizacion] = await Promise.all([
    getRecentCompras(6),
    getRecentPayments(["PROVEEDOR", "AMBOS"], 6),
    getEntitySaldos(["PROVEEDOR", "AMBOS"]),
    getCompras(),
    getPagos(["PROVEEDOR", "AMBOS"]),
    getValuacionInsumos(),
    getUltimaCotizacion(),
  ]);

  // El saldo a favor en la cuenta por la que se retira para los socios no es deuda de nadie: sale
  // del total y se muestra por separado, que es lo que en realidad es.
  const { deuda, retiros } = separarRetiroSocietario(saldos);

  // No se pueden sumar pesos con dólares: los saldos en dólares se valúan con la última cotización
  // cargada, y si todavía no hay ninguna se muestran aparte en vez de inventar una.
  const { total: deudaTotal, dolaresSinValuar } = sumarSaldosEnPesos(deuda, cotizacion);
  const hayCuentasEnDolares = deuda.some((s) => s.entity.moneda === "USD");
  const compraKpi = primaryAndExtra(comprasDelMes);
  const pagoKpi = primaryAndExtra(pagosDelMes);

  // A quiénes más les debemos, por el total de las dos cuentas: sólo a los que les debemos algo, sin
  // la cuenta por la que retiran los socios (va en su propia tarjeta de arriba).
  const enPesos = (f: (typeof deuda)[number]) => (f.entity.moneda === "USD" && cotizacion ? f.total * cotizacion.toNumber() : f.total);
  const lesDebemos = deuda.filter((f) => f.total > 0).sort((a, b) => enPesos(b) - enPesos(a));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Dashboard Proveedores</h1>
        <p className="text-sm text-foreground/60">
          Lo que les debemos y lo último que compramos y pagamos.
        </p>
      </div>

      <div
        className={`grid gap-4 sm:grid-cols-2 ${retiros.length > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
      >
        <KpiCard
          label="Deuda total a proveedores"
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
          icon={Building2}
          color="red"
        />
        <KpiCard
          label="Compras del mes"
          value={compraKpi.primary}
          caption={compraKpi.extra}
          icon={ShoppingCart}
          color="blue"
        />
        <KpiCard
          label="Pagos del mes"
          value={pagoKpi.primary}
          caption={pagoKpi.extra}
          icon={Banknote}
          color="green"
        />
        <KpiCard
          label="Valuación de insumos en stock"
          value={formatMoney(valuacion.total)}
          icon={Package}
          color="amber"
        />
        {retiros.length > 0 && (
          <KpiCard
            label="Retiro societario"
            value={retiros.map((r) => formatMoney(r.monto, r.moneda)).join(" + ")}
            caption={`acumulado, saldo a favor en ${retiros.map((r) => r.nombre).join(", ")}`}
            icon={HandCoins}
            color="amber"
          />
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Tarjeta
          titulo="A quiénes les debemos"
          resumen={
            lesDebemos.length === 0
              ? "No le debemos nada a ningún proveedor."
              : `${lesDebemos.length} ${lesDebemos.length === 1 ? "proveedor" : "proveedores"}`
          }
          href="/proveedores?saldo=deuda"
        >
          {lesDebemos.slice(0, 6).map((f) => (
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

        <Tarjeta titulo="Últimas compras" href="/compras">
          {compras.map((doc) => (
            <Renglon
              key={doc.id}
              izquierda={`${doc.account.entity.name} · #${doc.number}`}
              debajo={`${formatFecha(doc.date)} · ${doc.purchaseLines.map((l) => l.item.name).join(", ")}`}
              derecha={formatMoney(doc.totalAmount, doc.currency)}
              href={`/cuentas-corrientes/${doc.account.entity.slug}`}
            />
          ))}
          {compras.length === 0 && <p className="py-2 text-sm text-foreground/40">Todavía no hay compras cargadas.</p>}
        </Tarjeta>

        <Tarjeta titulo="Últimos pagos" href="/pagos-proveedores">
          {pagos.map((p) => (
            <Renglon
              key={p.id}
              izquierda={p.account.entity.name}
              debajo={`${formatFecha(p.date)} · ${PAYMENT_METHOD_LABELS[p.method]}`}
              derecha={formatMoney(p.amount, p.currency)}
              href={`/cuentas-corrientes/${p.account.entity.slug}`}
            />
          ))}
          {pagos.length === 0 && <p className="py-2 text-sm text-foreground/40">Todavía no hay pagos cargados.</p>}
        </Tarjeta>
      </div>

      {isAdmin && <ReportesGerenciales valuacion={valuacion} />}
    </div>
  );
}

async function ReportesGerenciales({
  valuacion,
}: {
  valuacion: Awaited<ReturnType<typeof getValuacionInsumos>>;
}) {
  const costo = await getCostoInsumos();

  const totalPorCategoria = new Map<string, Prisma.Decimal>();
  for (const { item, valuacion: v } of valuacion.rows) {
    if (!v) continue;
    const current = totalPorCategoria.get(item.category) ?? ZERO;
    totalPorCategoria.set(item.category, current.plus(v));
  }
  const categorias = Array.from(totalPorCategoria.entries()).sort((a, b) => b[1].comparedTo(a[1]));

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Reportes gerenciales</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm font-semibold mb-1">Costo de insumos consumidos (este mes)</p>
          <p className="text-2xl font-semibold">{formatMoney(costo.total)}</p>
          <p className="text-xs text-foreground/50 mt-1">
            insumos consumidos en producción este mes, valorizados a costo unitario.
            {costo.itemsSinCosto > 0 &&
              ` — ${costo.itemsSinCosto} insumo(s) consumido(s) sin costo unitario cargado, no se incluyeron.`}
          </p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm font-semibold mb-1">Valuación de insumos en stock, por tipo</p>
          <p className="text-2xl font-semibold">{formatMoney(valuacion.total)}</p>
          <div className="mt-2 space-y-1">
            {categorias.map(([category, total]) => (
              <div key={category} className="flex items-center justify-between text-sm border-b border-foreground/5 py-1">
                <span>{SUPPLIER_CATEGORY_LABELS[category as keyof typeof SUPPLIER_CATEGORY_LABELS]}</span>
                <span className="font-medium">{formatMoney(total)}</span>
              </div>
            ))}
            {categorias.length === 0 && (
              <p className="py-2 text-sm text-foreground/40">Todavía no hay insumos con costo cargado.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
