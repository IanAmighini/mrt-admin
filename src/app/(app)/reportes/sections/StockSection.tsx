import Link from "next/link";
import { Boxes, CalendarCheck, TriangleAlert } from "lucide-react";
import { formatQuantity } from "@/lib/money";
import { formatPallets } from "@/lib/product-label";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { getStockReport, type StockReportRow } from "@/lib/reports";
import type { Period } from "@/lib/period";
import type { SupplierCategory } from "@prisma/client";
import { formatFecha } from "@/lib/period";

export async function StockSection({ period }: { period: Period }) {
  const report = await getStockReport(period);
  const ultimo = report.recuentos[0];

  const porCategoria = new Map<string, StockReportRow[]>();
  for (const fila of report.insumos) {
    const lista = porCategoria.get(fila.categoria) ?? [];
    lista.push(fila);
    porCategoria.set(fila.categoria, lista);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Último recuento"
          value={ultimo ? formatFecha(ultimo.fecha) : "—"}
          caption={ultimo ? `${ultimo.insumos} insumos · ${ultimo.productos} productos` : "todavía no se contó"}
          icon={CalendarCheck}
          color="blue"
        />
        <KpiCard label="Recuentos hechos" value={String(report.recuentos.length)} icon={Boxes} color="amber" />
        <KpiCard
          label="Con diferencia en el período"
          value={`${report.totalAjustes.insumos + report.totalAjustes.productos}`}
          caption="renglones donde lo contado no coincidió con el sistema"
          icon={TriangleAlert}
          color="red"
        />
      </div>

      <p className="max-w-3xl text-sm text-foreground/60">
        La columna <strong className="text-foreground/80">Diferencia</strong> es la única que no
        tiene un comprobante detrás: es lo que apareció de más o de menos al contar el depósito.
        Entre dos recuentos, esa columna es la merma que nadie llegó a registrar. El resto —lo que
        entró, lo que se llevó la producción, las mermas anotadas y las ventas— sale de lo que se
        cargó en cada pantalla.
      </p>

      {report.recuentos.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Recuentos</h2>
          <div className="flex flex-wrap gap-2">
            {report.recuentos.map((r) => (
              <span
                key={r.fecha.toISOString()}
                className="rounded-lg border border-foreground/15 bg-background px-3 py-1.5 text-sm"
              >
                {formatFecha(r.fecha)}
                <span className="text-foreground/50">
                  {" "}
                  · {r.insumos} insumos · {r.productos} productos
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <Tabla
        titulo="Producto terminado"
        filas={report.productos}
        href={(f) => `/produccion/${f.slug}`}
        entradaLabel="Producido"
        salidaLabel="Entregado"
      />

      {Array.from(porCategoria.entries()).map(([categoria, filas]) => (
        <Tabla
          key={categoria}
          titulo={SUPPLIER_CATEGORY_LABELS[categoria as SupplierCategory] ?? categoria}
          filas={filas}
          href={(f) => `/stock/${f.slug}`}
          entradaLabel="Ingresos"
          salidaLabel="Consumo"
        />
      ))}
    </div>
  );
}

function Tabla({
  titulo,
  filas,
  href,
  entradaLabel,
  salidaLabel,
}: {
  titulo: string;
  filas: StockReportRow[];
  href: (fila: StockReportRow) => string;
  entradaLabel: string;
  salidaLabel: string;
}) {
  // Un renglón que no se movió y está en cero no dice nada; esconderlo deja ver los que sí.
  const visibles = filas.filter(
    (f) => !f.inicial.isZero() || !f.final.isZero() || !f.ingresos.isZero() || !f.consumo.isZero()
  );
  if (visibles.length === 0) return null;

  const cantidad = (fila: StockReportRow, valor: StockReportRow["inicial"]) =>
    fila.boxesPerPallet !== null || fila.unidad === "pallets"
      ? formatPallets(valor, fila.boxesPerPallet)
      : formatQuantity(valor, fila.unidad);

  return (
    <section>
      <h2 className="text-sm font-semibold mb-2">{titulo}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Insumo</th>
              <th className="py-2 pr-4 text-right">Inicial</th>
              <th className="py-2 pr-4 text-right">{entradaLabel}</th>
              <th className="py-2 pr-4 text-right">{salidaLabel}</th>
              <th className="py-2 pr-4 text-right">Mermas</th>
              <th className="py-2 pr-4 text-right">Diferencia</th>
              <th className="py-2 pr-4 text-right">Final</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4">
                  <Link href={href(f)} className="underline underline-offset-2">
                    {f.nombre}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-foreground/60">
                  {cantidad(f, f.inicial)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {f.ingresos.isZero() ? "—" : cantidad(f, f.ingresos)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {f.consumo.isZero() ? "—" : cantidad(f, f.consumo)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {f.mermas.isZero() ? "—" : cantidad(f, f.mermas)}
                </td>
                <td
                  className={`py-2 pr-4 text-right tabular-nums ${
                    f.ajustes.isZero()
                      ? "text-foreground/30"
                      : f.ajustes.isNegative()
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "font-medium text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {f.ajustes.isZero() ? "—" : cantidad(f, f.ajustes)}
                </td>
                <td className="py-2 pr-4 text-right font-medium tabular-nums">
                  {cantidad(f, f.final)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
