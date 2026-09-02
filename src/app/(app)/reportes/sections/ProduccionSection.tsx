import Link from "next/link";
import { Boxes, Droplets, Factory, Wallet } from "lucide-react";
import { formatMoney, formatQuantity } from "@/lib/money";
import { KpiCard } from "@/components/KpiCard";
import { getProduccionReport } from "@/lib/reports";
import type { Period } from "@/lib/period";

export async function ProduccionSection({ period }: { period: Period }) {
  const report = await getProduccionReport(period);
  const { costoInsumos } = report;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Pallets producidos" value={formatQuantity(report.totalPallets)} icon={Boxes} color="blue" />
        <KpiCard label="Litros envasados" value={formatQuantity(report.litrosEnvasados, "L")} icon={Droplets} color="blue" />
        <KpiCard label="Corridas" value={String(report.corridas.length)} icon={Factory} color="amber" />
        <KpiCard
          label="Costo de insumos"
          value={formatMoney(costoInsumos.total)}
          caption={costoInsumos.itemsSinCosto > 0 ? `parcial: ${costoInsumos.itemsSinCosto} insumo(s) sin costo cargado` : undefined}
          icon={Wallet}
          color="red"
        />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Por producto</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Producto</th>
                <th className="py-2 pr-4">Pallets</th>
                <th className="py-2 pr-4">Botellas</th>
              </tr>
            </thead>
            <tbody>
              {report.porProducto.map((p) => (
                <tr key={p.productSlug} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">
                    <Link href={`/produccion/${p.productSlug}`} className="underline underline-offset-2">
                      {p.label}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{formatQuantity(p.pallets)}</td>
                  <td className="py-2 pr-4">{formatQuantity(p.botellas)}</td>
                </tr>
              ))}
              {report.porProducto.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-foreground/40">
                    Sin producción en este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {costoInsumos.porItem.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Insumos consumidos</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Insumo</th>
                  <th className="py-2 pr-4">Cantidad</th>
                  <th className="py-2 pr-4">Costo</th>
                </tr>
              </thead>
              <tbody>
                {costoInsumos.porItem.map((r) => (
                  <tr key={r.item.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link href={`/stock/${r.item.slug}`} className="underline underline-offset-2">
                        {r.item.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{formatQuantity(r.cantidad, r.item.unit)}</td>
                    <td className="py-2 pr-4 font-medium">
                      {r.costo ? formatMoney(r.costo) : <span className="text-foreground/40">sin costo cargado</span>}
                    </td>
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
