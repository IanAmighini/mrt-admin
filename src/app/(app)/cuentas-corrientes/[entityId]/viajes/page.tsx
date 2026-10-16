import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ETIQUETA } from "@/components/Etiquetas";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { findBySlugOrId, slugDeEntidad } from "@/lib/slug-lookup";
import { getCuadrosDeViajes } from "@/lib/entregas";
import { formatMoney, formatQuantity, sumDecimals } from "@/lib/money";
import { formatFecha } from "@/lib/period";
import { formatProductBrandLabel } from "@/lib/product-label";
import { DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";

/**
 * Todos los viajes (o partes) de una cuenta, uno abajo del otro y plegados: cada uno dice qué
 * remitos, cuánto llevó y cuánto falta cobrar; abierto, lo que llevó renglón por renglón y la
 * cuenta del viaje con su saldo corrido. Es la planilla de liquidación de camiones del Excel.
 */
export default async function ViajesJuntosPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId: entityParam } = await params;
  await requireUser();

  const entity = await findBySlugOrId(
    () => prisma.entity.findFirst({ where: slugDeEntidad(entityParam) }),
    (id) => prisma.entity.findUnique({ where: { id } }),
    entityParam
  );
  if (!entity) notFound();
  if (entityParam !== entity.slug) redirect(`/cuentas-corrientes/${entity.slug}/viajes`);

  const cuadros = await getCuadrosDeViajes(entity.id);
  const moneda = entity.moneda;
  const rotulo = entity.rotuloSubcuenta ?? "Viaje";
  const plural = `${rotulo}s`;
  const saldoTotal = sumDecimals(cuadros.map((c) => c.saldo));
  const conSaldo = cuadros.filter((c) => c.id && !c.saldo.isZero());

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/cuentas-corrientes/${entity.slug}`} className="text-sm underline underline-offset-2">
          ← {entity.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">
              {entity.name} — {plural.toLowerCase()}
            </h1>
            <p className="text-sm text-foreground/60">
              {cuadros.filter((c) => c.id).length} {plural.toLowerCase()} · {conSaldo.length} con saldo
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs text-foreground/50">Saldo de la cuenta</p>
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(saldoTotal, moneda)}</p>
          </div>
        </div>
      </div>

      {/* Cada viaje plegado: a quién, qué remitos, cuánto llevó y cuánto falta. Abierto, lo que llevó
          renglón por renglón y la cuenta del viaje con su saldo corrido. Antes eran dos tablas anchas
          por viaje y los importes se cortaban. */}
      <div className="space-y-2">
      {cuadros.map((c) => {
        // Lo que llevó, sin restarle lo devuelto: "1 pallet + -69 cajas" no se entendía. La devolución
        // va en su propia etiqueta.
        const cantidadDe = (rs: typeof c.renglones) => {
          const pallets = rs.reduce((a, r) => a + r.pallets, 0);
          const cajas = rs.reduce((a, r) => a + r.cajas, 0);
          return [pallets ? `${formatQuantity(pallets)} ${pallets === 1 ? "pallet" : "pallets"}` : null, cajas ? `${formatQuantity(cajas)} ${cajas === 1 ? "caja" : "cajas"}` : null].filter(Boolean).join(" + ");
        };
        const cantidad = cantidadDe(c.renglones.filter((r) => !r.devolucion));
        const devuelto = cantidadDe(c.renglones.filter((r) => r.devolucion));
        const saldado = c.saldo.abs().lessThan(0.005);
        return (
          <details key={c.id ?? "sin-asignar"} className="group rounded-xl border border-foreground/10 bg-background shadow-sm">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-foreground/[0.02] [&::-webkit-details-marker]:hidden">
              <ChevronRight size={16} className="shrink-0 text-foreground/40 transition-transform group-open:rotate-90" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.nombre}
                  {c.destino && <span className="font-normal text-foreground/50"> · {c.destino}</span>}
                  {c.fecha && <span className="text-sm font-normal text-foreground/50"> · {formatFecha(c.fecha)}</span>}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.remitos.length > 0 && (
                    <span className={ETIQUETA}>
                      {c.remitos.length === 1 ? "Remito" : "Remitos"} {c.remitos.join(" · ")}
                    </span>
                  )}
                  {cantidad && <span className={ETIQUETA}>{cantidad}</span>}
                  {devuelto && (
                    <span className="whitespace-nowrap rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
                      Devolvió {devuelto}
                    </span>
                  )}
                  {c.total.greaterThan(0) && <span className={ETIQUETA}>Total {formatMoney(c.total, moneda)}</span>}
                  <span
                    className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${
                      saldado
                        ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                        : c.saldo.greaterThan(0)
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    }`}
                  >
                    {saldado ? "Cobrado" : c.saldo.greaterThan(0) ? `Falta cobrar ${formatMoney(c.saldo, moneda)}` : `A favor ${formatMoney(c.saldo.negated(), moneda)}`}
                  </span>
                </div>
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                <p className="text-xs text-foreground/50">Saldo</p>
                <p className={`text-lg font-semibold tabular-nums ${saldado ? "text-green-700 dark:text-green-400" : ""}`}>
                  {formatMoney(c.saldo, moneda)}
                </p>
              </div>
            </summary>

            <div className="grid gap-0 border-t border-foreground/10 lg:grid-cols-2 lg:divide-x lg:divide-foreground/10">
              {c.renglones.length > 0 && (
                <div className="min-w-0">
                  <p className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-foreground/40">Lo que llevó</p>
                  <div className="divide-y divide-foreground/10">
                    {c.renglones.map((r) => (
                      <div key={r.id} className={`flex items-start justify-between gap-3 px-4 py-2.5 text-sm ${r.devolucion ? "text-red-700 dark:text-red-400" : ""}`}>
                        <div className="min-w-0">
                          <p>
                            {formatProductBrandLabel(r.marca)} {r.formato}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <span className={ETIQUETA}>
                              {r.devolucion ? "Devolución" : "Remito"} #{r.remito}
                            </span>
                            <span className={ETIQUETA}>
                              {[r.pallets ? `${formatQuantity(r.pallets)} ${r.pallets === 1 ? "pallet" : "pallets"}` : null, r.cajas ? `${formatQuantity(r.cajas)} cj` : null, r.botellas ? `${formatQuantity(r.botellas)} bot` : null].filter(Boolean).join(" + ")}
                              {" · "}
                              {formatQuantity(r.unidades)} u.
                            </span>
                            {r.precioUnitario && <span className={ETIQUETA}>{formatMoney(r.precioUnitario, moneda)}/u.</span>}
                            <span className={ETIQUETA}>{formatFecha(r.fecha)}{r.vencimiento ? ` · vence ${formatFecha(r.vencimiento)}` : ""}</span>
                            {r.circuito === "BLANCO" && <span className={ETIQUETA}>Cuenta 1</span>}
                          </div>
                        </div>
                        <p className="shrink-0 font-semibold tabular-nums">{formatMoney(r.importe, moneda)}</p>
                      </div>
                    ))}
                    <div className="flex justify-between px-4 py-2.5 text-sm font-semibold">
                      <span>Total {rotulo.toLowerCase()}</span>
                      <span className="tabular-nums">{formatMoney(sumDecimals(c.renglones.map((r) => r.importe)), moneda)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className={`min-w-0 ${c.renglones.length > 0 ? "border-t border-foreground/10 lg:border-t-0" : "lg:col-span-2"}`}>
                <p className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-foreground/40">Cuenta del {rotulo.toLowerCase()}</p>
                <div className="divide-y divide-foreground/10">
                  {c.movimientos.map((m) => {
                    const doc = m.documento;
                    const detalle = doc
                      ? doc.type === "REMITO"
                        ? `Remito #${doc.number}`
                        : doc.type === "NOTA_CREDITO" && doc.reason?.startsWith("Devolución")
                          ? `Devolución #${doc.number}`
                          : doc.type === "AJUSTE" && doc.number.startsWith("SALDO-INICIAL")
                            ? "Saldo inicial"
                            : `${DOCUMENT_TYPE_LABELS[doc.type]} #${doc.number}`
                      : `Cobro · ${m.pago ? PAYMENT_METHOD_LABELS[m.pago.method] : ""}${m.detalle ? ` · ${m.detalle}` : ""}`;
                    return (
                      <div key={`${m.tipo}-${m.id}`} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p>
                            {detalle}
                            {doc?.destinatario && <span className="text-foreground/50"> — {doc.destinatario.nombre}</span>}
                          </p>
                          <p className="text-xs text-foreground/50">{formatFecha(m.fecha)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`tabular-nums ${m.monto.isNegative() ? "text-green-700 dark:text-green-400" : ""}`}>{formatMoney(m.monto, moneda)}</p>
                          <p className="text-xs tabular-nums text-foreground/50">saldo {formatMoney(m.saldo, moneda)}</p>
                        </div>
                      </div>
                    );
                  })}
                  {c.movimientos.length === 0 && <p className="px-4 py-4 text-center text-sm text-foreground/40">Sin movimientos todavía.</p>}
                </div>
              </div>
            </div>
            {c.id && (
              <div className="border-t border-foreground/10 px-4 py-2 text-right">
                <Link href={`/cuentas-corrientes/${entity.slug}/viaje/${c.id}`} className="text-xs text-foreground/60 hover:text-foreground hover:underline">
                  Abrir el {rotulo.toLowerCase()} →
                </Link>
              </div>
            )}
          </details>
        );
      })}
      </div>

      {cuadros.length === 0 && (
        <p className="rounded-xl border border-foreground/10 bg-background px-4 py-8 text-center text-foreground/40 shadow-sm">
          Esta cuenta todavía no tiene {plural.toLowerCase()}. Se cargan desde la ficha.
        </p>
      )}
    </div>
  );
}
