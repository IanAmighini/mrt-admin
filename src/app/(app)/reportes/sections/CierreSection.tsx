import Link from "next/link";
import { Package, TrendingDown, TrendingUp } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { formatMoney, formatQuantity, ZERO } from "@/lib/money";
import { EXPENSE_CATEGORY_LABELS, SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { getCierreReport, getResultadoReport, type CierreFilaInsumo } from "@/lib/reports";
import { Barras } from "@/components/dashboard/Graficos";
import { formatFecha, type Period } from "@/lib/period";
import { BalanceTabla } from "./BalanceTabla";

const verde = "text-green-700 dark:text-green-400";
const rojo = "text-red-600 dark:text-red-400";
const color = (n: Prisma.Decimal) => (n.isNegative() ? rojo : n.isZero() ? "" : verde);
/** "+ $ 1.000" / "− $ 1.000": la diferencia siempre con su signo, que es lo que se mira. */
const conSigno = (n: Prisma.Decimal) => `${n.isNegative() ? "−" : n.isZero() ? "" : "+"} ${formatMoney(n.abs())}`.trim();
const cantidad = (n: Prisma.Decimal, unidad: string) => (n.isZero() ? "—" : formatQuantity(n, unidad));

export async function CierreSection({ period }: { period: Period }) {
  // El cierre y lo que era el reporte de Resultado (unidos el 30/10/2026): mes a mes, gastos por
  // rubro y retiros. Las mismas cotizaciones y costos, así que los números del mes coinciden.
  const [r, res] = await Promise.all([getCierreReport(period), getResultadoReport(period)]);
  const { insumos, producto, resultado } = r;
  const difInsumos = insumos.cierre.minus(insumos.inicio);
  const difProducto = producto.cierre.minus(producto.inicio);
  const stockInicio = insumos.inicio.plus(producto.inicio);
  const stockCierre = insumos.cierre.plus(producto.cierre);
  const difStock = stockCierre.minus(stockInicio);
  const gano = !resultado.resultado.isNegative();
  const ini = formatFecha(r.inicio);
  const fin = formatFecha(r.cierre);

  const porCategoria = new Map<string, CierreFilaInsumo[]>();
  for (const f of insumos.filas) {
    const lista = porCategoria.get(f.categoria) ?? [];
    lista.push(f);
    porCategoria.set(f.categoria, lista);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard
          label={gano ? "Se ganó" : "Se perdió"}
          value={formatMoney(resultado.resultado.abs())}
          caption="ventas menos lo que costó lo vendido, menos los gastos"
          icon={gano ? TrendingUp : TrendingDown}
          color={gano ? "green" : "red"}
        />
        <KpiCard
          label={difStock.isNegative() ? "El stock vale menos" : "El stock vale más"}
          value={formatMoney(difStock.abs())}
          caption={`que al ${ini}: insumos y producto terminado, al ${fin}`}
          icon={Package}
          color={difStock.isNegative() ? "amber" : "blue"}
        />
      </div>

      <p className="max-w-3xl text-sm text-foreground/70">
        {gano ? "Se ganaron " : "Se perdieron "}
        <strong className={gano ? verde : rojo}>{formatMoney(resultado.resultado.abs())}</strong>. El stock vale{" "}
        <strong className={color(difStock)}>
          {formatMoney(difStock.abs())} {difStock.isNegative() ? "menos" : "más"}
        </strong>{" "}
        que al {ini}: los insumos <span className={color(difInsumos)}>{conSigno(difInsumos)}</span> y el producto
        terminado <span className={color(difProducto)}>{conSigno(difProducto)}</span>. Lo comprado y no vendido no
        es pérdida: está en el depósito, como insumo o ya envasado.
      </p>

      {/* Uno debajo del otro: con los dos menús de la izquierda, lado a lado no entraban los importes. */}
      <div className="grid max-w-3xl gap-4">
        <section className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
          <h3 className="border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5 font-semibold">Resultado</h3>
          <table className="w-full text-sm">
            <tbody className="tabular-nums">
              <Fila etiqueta="Ventas" valor={formatMoney(resultado.ventas)} />
              <Fila etiqueta="Costo de lo vendido" detalle="por receta, a lo que costaba cada insumo" valor={`− ${formatMoney(resultado.costo)}`} />
              <Fila etiqueta="Margen" valor={formatMoney(resultado.margen)} fuerte />
              <Fila etiqueta="Gastos" valor={`− ${formatMoney(resultado.gastos)}`} />
              <Fila
                etiqueta="Resultado"
                valor={<span className={color(resultado.resultado)}>{conSigno(resultado.resultado)}</span>}
                fuerte
              />
            </tbody>
          </table>
        </section>

        <section className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
          <h3 className="border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5 font-semibold">Stock</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-foreground/50">
                  <th className="px-4 py-2 font-medium" />
                  <th className="px-4 py-2 text-right font-medium">Al {ini}</th>
                  <th className="px-4 py-2 text-right font-medium">Al {fin}</th>
                  <th className="px-4 py-2 text-right font-medium">Diferencia</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-foreground/5">
                  <td className="px-4 py-2">Insumos</td>
                  <td className="px-4 py-2 text-right">{formatMoney(insumos.inicio)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(insumos.cierre)}</td>
                  <td className={`whitespace-nowrap px-4 py-2 text-right ${color(difInsumos)}`}>{conSigno(difInsumos)}</td>
                </tr>
                <tr className="text-xs text-foreground/60">
                  <td className="py-1 pl-8 pr-4" colSpan={3}>
                    por cantidad (hay más o menos)
                  </td>
                  <td className="whitespace-nowrap px-4 py-1 text-right">{conSigno(insumos.porCantidad)}</td>
                </tr>
                <tr className="text-xs text-foreground/60">
                  <td className="py-1 pl-12 pr-4" colSpan={3}>
                    de eso, mermas y diferencias de recuento
                  </td>
                  <td className="whitespace-nowrap px-4 py-1 text-right">{conSigno(insumos.mermasYRecuento)}</td>
                </tr>
                <tr className="text-xs text-foreground/60">
                  <td className="py-1 pl-8 pr-4" colSpan={3}>
                    por precio (cambió lo que cuestan)
                  </td>
                  <td className="whitespace-nowrap px-4 py-1 text-right">{conSigno(insumos.porPrecio)}</td>
                </tr>
                <tr className="border-t border-foreground/5">
                  <td className="px-4 py-2">Producto terminado</td>
                  <td className="px-4 py-2 text-right">{formatMoney(producto.inicio)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(producto.cierre)}</td>
                  <td className={`whitespace-nowrap px-4 py-2 text-right ${color(difProducto)}`}>{conSigno(difProducto)}</td>
                </tr>
                <tr className="border-t border-foreground/10 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">{formatMoney(stockInicio)}</td>
                  <td className="px-4 py-2 text-right">{formatMoney(stockCierre)}</td>
                  <td className={`whitespace-nowrap px-4 py-2 text-right ${color(difStock)}`}>{conSigno(difStock)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {(insumos.sinCosto > 0 || producto.sinCosto > 0) && (
            <p className="border-t border-foreground/5 px-4 py-2 text-xs text-foreground/50">
              {[
                insumos.sinCosto > 0 && `${insumos.sinCosto} insumo(s) con stock no tienen costo`,
                producto.sinCosto > 0 && `${producto.sinCosto} producto(s) sin receta o sin costo de algún insumo`,
              ]
                .filter(Boolean)
                .join(" y ")}
              : no suman.
            </p>
          )}
        </section>

        <BalanceTabla balance={r.balance} ini={ini} fin={fin} />
      </div>

      <section className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
        <h3 className="border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5 font-semibold">Mes a mes</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground/50">
                <th className="px-4 py-2 font-medium">Mes</th>
                <th className="px-3 py-2 text-right font-medium">Ventas</th>
                <th className="px-3 py-2 text-right font-medium">Costo de lo vendido</th>
                <th className="px-3 py-2 text-right font-medium">Gastos</th>
                <th className="px-4 py-2 text-right font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {/* Sin los meses de antes de la app: todo en cero no dice nada. */}
              {res.meses
                .filter((m) => !m.ventas.isZero() || !m.costoInsumos.isZero() || !m.gastos.isZero())
                .map((m) => (
                <tr key={m.from.toISOString()} className="border-t border-foreground/5">
                  <td className="px-4 py-2 capitalize">{m.label}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{m.ventas.isZero() ? "—" : formatMoney(m.ventas.toDecimalPlaces(0))}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-foreground/60">{m.costoInsumos.isZero() ? "—" : formatMoney(m.costoInsumos.toDecimalPlaces(0))}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-foreground/60">{m.gastos.isZero() ? "—" : formatMoney(m.gastos.toDecimalPlaces(0))}</td>
                  <td className={`whitespace-nowrap px-4 py-2 text-right font-medium ${color(m.resultado)}`}>
                    {m.resultado.isZero() ? "—" : conSigno(m.resultado.toDecimalPlaces(0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-foreground/50">
          Hasta seis meses. La app arrancó el 29/09/2026: lo de antes no está cargado.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
          <h3 className="border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5 font-semibold">
            En qué se fueron los gastos
          </h3>
          <div className="p-4">
            <Barras
              colorPorDefecto="naranja"
              filas={[
                ...res.porRubro.slice(0, 8).map((g) => ({
                  clave: g.category ?? "sin-rubro",
                  nombre: g.category ? EXPENSE_CATEGORY_LABELS[g.category] : "Sin rubro",
                  total: g.total,
                })),
                // Los rubros chicos juntos: con 22 renglones la tarjeta era una lista más.
                ...(res.porRubro.length > 8
                  ? [{ clave: "otros", nombre: `Otros ${res.porRubro.length - 8} rubros`, total: res.porRubro.slice(8).reduce((a, g) => a.plus(g.total), ZERO) }]
                  : []),
              ].map((g) => ({
                clave: g.clave,
                nombre: g.nombre,
                detalle: res.gastos.isZero() ? undefined : `${formatQuantity(g.total.dividedBy(res.gastos).times(100).toDecimalPlaces(1))}% del total`,
                valor: g.total,
              }))}
            />
          </div>
          <p className="px-4 pb-3 text-xs text-foreground/50">
            Lo que salió de verdad: el total de cada factura menos el IVA y las percepciones, que se
            recuperan. Lo no gravado y las contribuciones sí son gasto.
          </p>
        </section>

        {res.retiros.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
            <h3 className="border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5 font-semibold">Retiros de los socios</h3>
            <div className="divide-y divide-foreground/5">
              {res.retiros.map((x) => (
                <div key={x.nombre} className="space-y-1 px-4 py-3 text-sm">
                  <p className="font-medium">{x.nombre}</p>
                  <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
                    <span className="text-foreground/60">Se le dio</span>
                    <span className="text-right">{formatMoney(x.retirado, x.moneda)}</span>
                    {!x.aportado.isZero() && (
                      <>
                        <span className="text-foreground/60">Aportó</span>
                        <span className="text-right">− {formatMoney(x.aportado, x.moneda)}</span>
                      </>
                    )}
                    {!x.descontado.isZero() && (
                      <>
                        <span className="text-foreground/60">Se le descontó (aceite entregado, facturas)</span>
                        <span className="text-right">− {formatMoney(x.descontado, x.moneda)}</span>
                      </>
                    )}
                    <span className="border-t border-foreground/10 pt-0.5 text-foreground/60">Saldo a favor nuestro, acumulado</span>
                    <span className="border-t border-foreground/10 pt-0.5 text-right font-medium">{formatMoney(x.acumulado, x.moneda)}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="px-4 pb-3 text-xs text-foreground/50">
              No resta del resultado: lo que se llevan los socios es reparto de lo ganado. Cada uno va
              en la moneda de su cuenta.
            </p>
          </section>
        )}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Insumos, uno por uno</h3>
        <p className="mb-3 max-w-3xl text-xs text-foreground/50">
          Cuánto había al {ini}, qué entró (compras), qué se llevó la producción, qué se vendió, las mermas y lo que
          apareció o faltó al contar, y cuánto quedó al {fin}. Primero lo que más cambió de valor.
        </p>
        <div className="space-y-4">
          {insumos.categorias.map((c) => {
            const filas = porCategoria.get(c.category) ?? [];
            const dif = c.cierre.minus(c.inicio);
            return (
              <div key={c.category} className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5">
                  <h4 className="font-semibold">{SUPPLIER_CATEGORY_LABELS[c.category]}</h4>
                  <span className="text-sm tabular-nums">
                    {formatMoney(c.inicio)} → {formatMoney(c.cierre)}{" "}
                    <span className={`font-semibold ${color(dif)}`}>({conSigno(dif)})</span>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-foreground/50">
                        <th className="px-4 py-2 font-medium">Insumo</th>
                        <th className="px-3 py-2 text-right font-medium">Al {ini}</th>
                        <th className="px-3 py-2 text-right font-medium">Entró</th>
                        <th className="px-3 py-2 text-right font-medium">Producción</th>
                        <th className="px-3 py-2 text-right font-medium">Ventas</th>
                        <th className="px-3 py-2 text-right font-medium">Mermas y recuento</th>
                        <th className="px-3 py-2 text-right font-medium">Al {fin}</th>
                        <th className="px-4 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {filas.map((f) => {
                        const difValor = (f.valorCierre ?? ZERO).minus(f.valorInicio ?? ZERO);
                        return (
                          <tr key={f.itemId} className="border-t border-foreground/5">
                            <td className="min-w-48 px-4 py-2">
                              <Link href={`/stock/${f.slug}`} className="underline underline-offset-2">
                                {f.nombre}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">{formatQuantity(f.inicio, f.unidad)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">{cantidad(f.entradas, f.unidad)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">{cantidad(f.produccion, f.unidad)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">{cantidad(f.ventas, f.unidad)}</td>
                            <td className={`whitespace-nowrap px-3 py-2 text-right ${color(f.mermasYRecuento)}`}>
                              {f.mermasYRecuento.isZero()
                                ? "—"
                                : `${f.mermasYRecuento.isNegative() ? "−" : "+"} ${formatQuantity(f.mermasYRecuento.abs(), f.unidad)}`}
                            </td>
                            <td
                              className={`whitespace-nowrap px-3 py-2 text-right font-medium ${f.cierre.isNegative() ? rojo : ""}`}
                            >
                              {formatQuantity(f.cierre, f.unidad)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2 text-right">
                              {f.valorCierre ? formatMoney(f.valorCierre) : <span className="text-foreground/40">sin costo</span>}
                              {!difValor.isZero() && (
                                <span className={`block text-xs ${color(difValor)}`}>{conSigno(difValor)}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5">
          <h3 className="font-semibold">Producto terminado</h3>
          <span className="text-sm tabular-nums">
            {formatMoney(producto.inicio)} → {formatMoney(producto.cierre)}{" "}
            <span className={`font-semibold ${color(difProducto)}`}>({conSigno(difProducto)})</span>
          </span>
        </div>
        <p className="px-4 pt-2 text-xs text-foreground/50">
          A lo que cuesta su receta: el pallet entero, la caja suelta sin el pallet de madera ni el stretch, y la
          botella suelta sin la caja.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground/50">
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-3 py-2 text-right font-medium">Al {ini}</th>
                <th className="px-3 py-2 text-right font-medium">Al {fin}</th>
                <th className="px-4 py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {producto.filas.map((f) => {
                const difValor = (f.valorCierre ?? ZERO).minus(f.valorInicio ?? ZERO);
                return (
                  <tr key={f.clave} className="border-t border-foreground/5">
                    <td className="min-w-56 px-4 py-2">{f.nombre}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{f.inicio}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{f.cierre}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {f.valorCierre ? formatMoney(f.valorCierre) : <span className="text-foreground/40">sin costo</span>}
                      {!difValor.isZero() && <span className={`block text-xs ${color(difValor)}`}>{conSigno(difValor)}</span>}
                    </td>
                  </tr>
                );
              })}
              {producto.filas.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-foreground/40">
                    No había producto terminado ni al principio ni al final.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Fila({ etiqueta, detalle, valor, fuerte = false }: { etiqueta: string; detalle?: string; valor: React.ReactNode; fuerte?: boolean }) {
  return (
    <tr className={`border-t border-foreground/5 ${fuerte ? "font-semibold" : ""}`}>
      <td className="px-4 py-2">
        {etiqueta}
        {detalle && <span className="block text-xs font-normal text-foreground/50">{detalle}</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right">{valor}</td>
    </tr>
  );
}
