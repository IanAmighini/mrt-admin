import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ETIQUETA } from "@/components/Etiquetas";
import { cantidadDeRenglones, DetalleDelViaje } from "@/components/CuadroDeViaje";
import { generoDe } from "@/components/ViajeFields";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { findBySlugOrId, slugDeEntidad } from "@/lib/slug-lookup";
import { getCuadrosDeViajes } from "@/lib/entregas";
import { formatMoney, sumDecimals } from "@/lib/money";
import { formatFecha } from "@/lib/period";

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
  const esProveedor = entity.type === "PROVEEDOR";
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
        const cantidad = cantidadDeRenglones(c.renglones.filter((r) => !r.devolucion));
        const devuelto = cantidadDeRenglones(c.renglones.filter((r) => r.devolucion));
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
                    {saldado
                      ? esProveedor ? "Pagado" : "Cobrado"
                      : c.saldo.greaterThan(0)
                        ? `${esProveedor ? "Falta pagar" : "Falta cobrar"} ${formatMoney(c.saldo, moneda)}`
                        : `A favor ${formatMoney(c.saldo.negated(), moneda)}`}
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

            <div className="border-t border-foreground/10">
              <DetalleDelViaje renglones={c.renglones} movimientos={c.movimientos} moneda={moneda} rotulo={rotulo} esProveedor={esProveedor} />
            </div>
            {c.id && (
              <div className="border-t border-foreground/10 px-4 py-2 text-right">
                <Link href={`/cuentas-corrientes/${entity.slug}/viaje/${c.id}`} className="text-xs text-foreground/60 hover:text-foreground hover:underline">
                  Abrir {generoDe(rotulo).articulo} {rotulo.toLowerCase()} →
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
