import Link from "next/link";
import { CircleDollarSign, TriangleAlert } from "lucide-react";
import { formatMoney, formatQuantity } from "@/lib/money";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { getValorizacionReport, type ValorizacionRow } from "@/lib/reports";
import { formatFecha } from "@/lib/period";

export async function ValorizacionSection({ asOf }: { asOf: Date }) {
  const report = await getValorizacionReport({ asOf });

  const porCategoria = new Map<string, ValorizacionRow[]>();
  for (const fila of report.rows) {
    const lista = porCategoria.get(fila.category) ?? [];
    lista.push(fila);
    porCategoria.set(fila.category, lista);
  }

  return (
    <div className="space-y-6">
      {/* El total lleva cientos de millones: la tarjeta ancha, para que no se salga. */}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <KpiCard
          label="Valor del stock"
          value={formatMoney(report.total)}
          caption={`al ${formatFecha(report.asOf)}, en pesos: ${report.rows.length} insumos con stock en ${report.porCategoria.length} categorías`}
          icon={CircleDollarSign}
          color="green"
        />
        <KpiCard
          label="Sin costo"
          value={String(report.sinCosto)}
          caption={report.sinCosto > 0 ? "tienen stock pero no suman: falta su costo" : "todos tienen costo"}
          icon={TriangleAlert}
          color={report.sinCosto > 0 ? "red" : "green"}
        />
      </div>

      <p className="max-w-3xl text-sm text-foreground/60">
        Cada insumo vale lo que se pagó en su <strong className="text-foreground/80">última compra</strong>{" "}
        hasta ese día, pasada a pesos con la cotización de la compra si fue en dólares. Si nunca se
        compró, el <strong className="text-foreground/80">costo de la ficha</strong>. Un envase vale su
        soplado más la preforma. Es el mismo costo que usa el margen.
        {report.sinCosto > 0 && " Los que dicen «sin costo» se completan cargando el costo unitario en su ficha."}
      </p>

      {report.porCategoria.map((c) => {
        const filas = porCategoria.get(c.category) ?? [];
        return (
          <section key={c.category} className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5">
              <h3 className="font-semibold">
                {SUPPLIER_CATEGORY_LABELS[c.category]}
                <span className="ml-2 text-xs font-normal text-foreground/50">{c.count} insumo{c.count === 1 ? "" : "s"}</span>
              </h3>
              <span className="font-semibold tabular-nums">{formatMoney(c.valor)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
                    <th className="px-4 py-2 font-medium">Insumo</th>
                    <th className="px-4 py-2 text-right font-medium">Stock</th>
                    <th className="px-4 py-2 text-right font-medium">Costo unitario</th>
                    <th className="px-4 py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.itemId} className="border-b border-foreground/5 last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/stock/${f.itemSlug}`} className="underline underline-offset-2">
                          {f.itemName}
                        </Link>
                        {f.origen && <span className="block text-xs text-foreground/50">{f.origen}</span>}
                        {f.faltaPreforma && (
                          <span className="block text-xs text-amber-700 dark:text-amber-400">
                            sin precio de {f.faltaPreforma}: es sólo el soplado
                          </span>
                        )}
                      </td>
                      <td
                        className={`whitespace-nowrap px-4 py-2 text-right tabular-nums ${
                          f.stock.isNegative() ? "font-medium text-red-600 dark:text-red-400" : ""
                        }`}
                      >
                        {formatQuantity(f.stock, f.unit)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                        {f.unitario ? formatMoney(f.unitario) : <span className="text-foreground/40">sin costo</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums">
                        {f.valor ? formatMoney(f.valor) : <span className="font-normal text-foreground/40">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {report.rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-foreground/15 p-6 text-center text-sm text-foreground/50">
          No había insumos con stock ese día.
        </p>
      )}
    </div>
  );
}
