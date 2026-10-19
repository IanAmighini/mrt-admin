import Link from "next/link";
import { formatMoney, formatQuantity, ZERO } from "@/lib/money";
import { formatFecha, type Period } from "@/lib/period";
import { getCostoBotellaReport, PARTES_DE_LA_BOTELLA } from "@/lib/reports";

/**
 * Lo que cuesta una botella de cada producto, por presentación y abierto por parte, con el precio
 * al que se vendió en el período al lado. Es la pregunta de siempre —¿cuánto me deja una de 900?—
 * que antes había que sacar a mano de la receta y de las facturas de Cristian.
 */
export async function CostoBotellaSection({ period }: { period: Period }) {
  const report = await getCostoBotellaReport(period);
  // "Otros" sólo si algún producto lo usa: casi ninguna receta lleva algo fuera de las seis partes.
  const partes = PARTES_DE_LA_BOTELLA.filter(
    (p) => p !== "Otros" || report.presentaciones.some((g) => g.productos.some((x) => !x.partes.Otros.isZero() || x.incompletas.includes("Otros")))
  );
  const hayFaltantes = report.presentaciones.some((g) => g.productos.some((x) => x.sinCosto.length > 0));

  return (
    <div className="space-y-6">
      <p className="text-sm text-foreground/60">
        Valuado al {formatFecha(report.valuadoAl)}: cada insumo a lo que se pagó en su última compra, en pesos —lo de
        Cristian con la cotización de ese día—, y el envase con su preforma. El precio es el promedio al que se vendió
        en el período, neto de IVA.
      </p>
      {hayFaltantes && (
        <p className="rounded-lg bg-amber-50 px-2 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Donde dice <strong>falta</strong>, algún insumo de esa parte no tiene ninguna compra cargada ni costo en su
          ficha, así que el costo de la botella queda corto (pasá el mouse para ver cuál). Se arregla cargando el costo
          unitario en la ficha del insumo.
        </p>
      )}

      {report.presentaciones.map((g) => {
        // El rango sólo con los que tienen todo: uno sin el aceite daba "de $ 186 a $ 1.729".
        const completos = g.productos.filter((p) => p.incompletas.length === 0);
        // Si ninguno está completo, al menos los que tienen el aceite, que es casi todo el costo.
        const conAceite = g.productos.filter((p) => !p.incompletas.includes("Aceite"));
        const totales = (completos.length > 0 ? completos : conAceite.length > 0 ? conAceite : g.productos).map((p) => p.total);
        const min = totales.reduce((a, b) => (b.lessThan(a) ? b : a), totales[0] ?? ZERO);
        const max = totales.reduce((a, b) => (b.greaterThan(a) ? b : a), totales[0] ?? ZERO);
        return (
          <section key={g.capacidadMl ?? "sin"} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
              <h2 className="text-sm font-semibold">
                {g.capacidadMl ? `Botella de ${formatQuantity(g.capacidadMl)} ml` : "Sin capacidad cargada"}
                <span className="font-normal text-foreground/50"> · {g.productos.length} {g.productos.length === 1 ? "producto" : "productos"}</span>
              </h2>
              <span className="text-sm tabular-nums text-foreground/60">
                {min.equals(max) ? formatMoney(min) : `de ${formatMoney(min)} a ${formatMoney(max)}`} por botella
                {completos.length === 0 && <span className="text-amber-700 dark:text-amber-400"> · incompleto</span>}
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-foreground/10 text-left text-xs text-foreground/50">
                    <th className="px-2 py-2 font-medium">Producto</th>
                    {partes.map((p) => (
                      <th key={p} className="px-2 py-2 text-right font-medium">
                        {p}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-right font-medium text-foreground/70">Costo</th>
                    <th className="px-2 py-2 text-right font-medium">Precio prom.</th>
                    <th className="px-2 py-2 text-right font-medium">Deja</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/5">
                  {g.productos.map((p) => {
                    const deja = p.precioPromedio ? p.precioPromedio.minus(p.total) : null;
                    const pct = deja && p.precioPromedio && !p.precioPromedio.isZero() ? deja.dividedBy(p.precioPromedio).times(100) : null;
                    return (
                      <tr key={p.productSlug}>
                        <td className="px-2 py-2">
                          <Link href={`/produccion/${p.productSlug}`} className="whitespace-nowrap hover:underline">
                            {p.label}
                          </Link>
                          <span className="block whitespace-nowrap text-xs text-foreground/50">
                            {p.formato}
                            {p.vendidas.greaterThan(0) && ` · ${formatQuantity(p.vendidas.round())} vendidas`}
                          </span>
                        </td>
                        {partes.map((parte) => (
                          <td key={parte} className="whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums text-foreground/70">
                            {p.incompletas.includes(parte) ? (
                              // Lo que se sabe y, abajo, que falta algo: el envase de 1.500 tiene el
                              // soplado pero no la preforma.
                              <span title={`Falta el costo de: ${p.sinCosto.join(", ")}`}>
                                {!p.partes[parte].isZero() && formatMoney(p.partes[parte])}
                                <span className="block text-amber-700 dark:text-amber-400">
                                  {p.partes[parte].isZero() ? "falta" : "+ falta"}
                                </span>
                              </span>
                            ) : p.partes[parte].isZero() ? (
                              <span className="text-foreground/30">—</span>
                            ) : (
                              formatMoney(p.partes[parte])
                            )}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">
                          {formatMoney(p.total)}
                          {p.incompletas.length > 0 && (
                            <span className="block text-xs font-normal text-amber-700 dark:text-amber-400">incompleto</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                          {p.precioPromedio ? formatMoney(p.precioPromedio) : <span className="text-foreground/30">—</span>}
                        </td>
                        <td
                          className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${
                            deja === null ? "" : deja.isNegative() ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"
                          }`}
                        >
                          {deja === null ? (
                            <span className="text-foreground/30">—</span>
                          ) : (
                            <>
                              {formatMoney(deja)}
                              {pct && <span className="block text-xs">{pct.toFixed(1).replace(".", ",")}%</span>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {report.presentaciones.length === 0 && (
        <p className="py-8 text-center text-sm text-foreground/40">Todavía no hay productos con receta.</p>
      )}
    </div>
  );
}
