import Link from "next/link";
import { Banknote, Building2, Package, ShoppingCart } from "lucide-react";
import type { Prisma, Currency } from "@prisma/client";
import { requireRole } from "@/lib/auth-helpers";
import { getEntitySaldos, getRecentCompras, getRecentPayments } from "@/lib/ledger";
import {
  getComprasDelMes,
  getCostoInsumosDelMes,
  getPagosDelMes,
  getValuacionInsumos,
} from "@/lib/reports";
import { formatMoney, sumDecimals, ZERO } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";

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

  const [compras, pagos, saldos, comprasDelMes, pagosDelMes, valuacion] = await Promise.all([
    getRecentCompras(5),
    getRecentPayments(["PROVEEDOR", "AMBOS"], 5),
    getEntitySaldos(["PROVEEDOR", "AMBOS"]),
    getComprasDelMes(),
    getPagosDelMes(["PROVEEDOR", "AMBOS"]),
    getValuacionInsumos(),
  ]);

  const deudaTotal = sumDecimals(saldos.map((s) => s.total));
  const compraKpi = primaryAndExtra(comprasDelMes);
  const pagoKpi = primaryAndExtra(pagosDelMes);

  const topBlanco = [...saldos]
    .sort((a, b) => (b.blancoSaldo?.toNumber() ?? 0) - (a.blancoSaldo?.toNumber() ?? 0))
    .slice(0, 5);
  const topNegro = [...saldos]
    .sort((a, b) => (b.negroSaldo?.toNumber() ?? 0) - (a.negroSaldo?.toNumber() ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Dashboard Proveedores</h1>
        <p className="text-sm text-foreground/60">
          Últimas compras, últimos pagos y proveedores a los que más les debemos.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Deuda total a proveedores" value={formatMoney(deudaTotal)} icon={Building2} color="red" />
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
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold mb-2">Últimas compras</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Proveedor</th>
                  <th className="py-2 pr-4">Remito</th>
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {compras.map((doc) => (
                  <tr key={doc.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${doc.account.entityId}`}
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
                {compras.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-foreground/40">
                      Todavía no hay compras cargadas.
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
                  <th className="py-2 pr-4">Proveedor</th>
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
                        href={`/cuentas-corrientes/${payment.account.entityId}`}
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

        <TopDeudaSection title="Proveedores que más les debemos — Cuenta Blanco" rows={topBlanco} circuit="blanco" />
        <TopDeudaSection title="Proveedores que más les debemos — Cuenta Negro" rows={topNegro} circuit="negro" />
      </div>

      {isAdmin && <ReportesGerenciales valuacion={valuacion} />}
    </div>
  );
}

type SaldoRow = Awaited<ReturnType<typeof getEntitySaldos>>[number];

function TopDeudaSection({
  title,
  rows,
  circuit,
}: {
  title: string;
  rows: SaldoRow[];
  circuit: "blanco" | "negro";
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold mb-2">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Proveedor</th>
              <th className="py-2 pr-4">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entity, blancoSaldo, negroSaldo }) => {
              const saldo = circuit === "blanco" ? blancoSaldo : negroSaldo;
              return (
                <tr key={entity.id} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">
                    <Link href={`/cuentas-corrientes/${entity.id}/${circuit}`} className="underline underline-offset-2">
                      {entity.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-medium">{saldo ? formatMoney(saldo) : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="py-4 text-center text-foreground/40">
                  Todavía no hay proveedores cargados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function ReportesGerenciales({
  valuacion,
}: {
  valuacion: Awaited<ReturnType<typeof getValuacionInsumos>>;
}) {
  const costo = await getCostoInsumosDelMes();

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
