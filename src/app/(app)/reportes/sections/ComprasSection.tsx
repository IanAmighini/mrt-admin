import Link from "next/link";
import { Building2, Package, ShoppingCart } from "lucide-react";
import { Prisma, type Currency } from "@prisma/client";
import { formatMoney, formatQuantity, ZERO } from "@/lib/money";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { getComprasReport } from "@/lib/reports";
import type { Period } from "@/lib/period";

function ars(byCurrency: Map<Currency, Prisma.Decimal>): Prisma.Decimal {
  return byCurrency.get("ARS") ?? ZERO;
}

export async function ComprasSection({ period }: { period: Period }) {
  const report = await getComprasReport(period);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Comprado en el período" value={formatMoney(ars(report.totales))} icon={ShoppingCart} color="red" />
        <KpiCard label="Proveedores" value={String(report.porProveedor.length)} icon={Building2} color="blue" />
        <KpiCard label="Insumos distintos" value={String(report.porInsumo.length)} icon={Package} color="amber" />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Por proveedor</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Proveedor</th>
                <th className="py-2 pr-4">Comprobantes</th>
                <th className="py-2 pr-4">Importe</th>
              </tr>
            </thead>
            <tbody>
              {report.porProveedor.map((p) => (
                <tr key={p.entitySlug} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">
                    <Link href={`/cuentas-corrientes/${p.entitySlug}`} className="underline underline-offset-2">
                      {p.entityName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{p.count}</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(ars(p.byCurrency))}</td>
                </tr>
              ))}
              {report.porProveedor.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-foreground/40">
                    Sin compras en este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {report.porCategoria.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Por tipo de insumo</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Categoría</th>
                  <th className="py-2 pr-4">Cantidades</th>
                  <th className="py-2 pr-4">Importe</th>
                </tr>
              </thead>
              <tbody>
                {report.porCategoria.map((c) => (
                  <tr key={c.category} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">{SUPPLIER_CATEGORY_LABELS[c.category]}</td>
                    <td className="py-2 pr-4 text-foreground/60">
                      {Array.from(c.qtyByUnit.entries())
                        .map(([unit, qty]) => formatQuantity(qty, unit))
                        .join(" · ")}
                    </td>
                    <td className="py-2 pr-4 font-medium">{formatMoney(ars(c.byCurrency))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report.porInsumo.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Por insumo</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Insumo</th>
                  <th className="py-2 pr-4">Cantidad</th>
                  <th className="py-2 pr-4">Importe</th>
                </tr>
              </thead>
              <tbody>
                {report.porInsumo.map((i) => (
                  <tr key={i.itemSlug} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link href={`/stock/${i.itemSlug}`} className="underline underline-offset-2">
                        {i.itemName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{formatQuantity(i.quantity, i.unit)}</td>
                    <td className="py-2 pr-4 font-medium">{formatMoney(ars(i.byCurrency))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
