import Link from "next/link";
import { PackageX, SlidersHorizontal, Wallet } from "lucide-react";
import { formatMoney, formatQuantity } from "@/lib/money";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { getInsumosMinimoReport } from "@/lib/reports";

export async function InsumosSection() {
  const report = await getInsumosMinimoReport();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Insumos bajo mínimo"
          value={String(report.rows.length)}
          caption={`de ${report.totalItems} insumos`}
          icon={PackageX}
          color={report.rows.length > 0 ? "red" : "green"}
        />
        <KpiCard
          label="Costo de reposición"
          value={formatMoney(report.costoReposicionTotal)}
          caption="solo insumos con costo cargado"
          icon={Wallet}
          color="amber"
        />
        <KpiCard
          label="Sin mínimo configurado"
          value={String(report.itemsSinMinimo)}
          caption="no se controlan"
          icon={SlidersHorizontal}
          color="blue"
        />
      </div>

      {report.itemsSinMinimo > 0 && (
        <p className="rounded-lg border border-foreground/10 bg-foreground/[0.02] px-4 py-3 text-sm text-foreground/70">
          Hay {report.itemsSinMinimo} insumo(s) sin stock mínimo cargado, así que no entran en este
          control. El mínimo se carga desde la ficha de cada insumo, en Stock.
        </p>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2">Detalle</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Insumo</th>
                <th className="py-2 pr-4">Categoría</th>
                <th className="py-2 pr-4">Stock actual</th>
                <th className="py-2 pr-4">Mínimo</th>
                <th className="py-2 pr-4">Faltante</th>
                <th className="py-2 pr-4">Costo reposición</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.itemId} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">
                    <Link href={`/stock/${row.itemSlug}`} className="underline underline-offset-2">
                      {row.itemName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{SUPPLIER_CATEGORY_LABELS[row.category]}</td>
                  <td className="py-2 pr-4 font-medium text-red-600 dark:text-red-400">
                    {formatQuantity(row.stock, row.unit)}
                  </td>
                  <td className="py-2 pr-4">{formatQuantity(row.minStock, row.unit)}</td>
                  <td className="py-2 pr-4">{formatQuantity(row.faltante, row.unit)}</td>
                  <td className="py-2 pr-4">
                    {row.costoReposicion ? (
                      formatMoney(row.costoReposicion)
                    ) : (
                      <span className="text-foreground/40">sin costo cargado</span>
                    )}
                  </td>
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-foreground/40">
                    Ningún insumo está por debajo de su mínimo. 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {report.porCategoria.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Por categoría</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Categoría</th>
                  <th className="py-2 pr-4">Insumos</th>
                  <th className="py-2 pr-4">Costo reposición</th>
                </tr>
              </thead>
              <tbody>
                {report.porCategoria.map((c) => (
                  <tr key={c.category} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">{SUPPLIER_CATEGORY_LABELS[c.category]}</td>
                    <td className="py-2 pr-4">{c.count}</td>
                    <td className="py-2 pr-4 font-medium">{formatMoney(c.costoReposicion)}</td>
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
