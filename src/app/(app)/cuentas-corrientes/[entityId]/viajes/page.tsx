import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { findBySlugOrId } from "@/lib/slug-lookup";
import { getCuadrosDeViajes } from "@/lib/entregas";
import { formatMoney, formatQuantity, sumDecimals } from "@/lib/money";
import { formatFecha } from "@/lib/period";
import { formatProductBrandLabel } from "@/lib/product-label";
import { DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";

const th = "py-2 px-3 text-left font-medium text-foreground/60 whitespace-nowrap";
const td = "py-1.5 px-3 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;

/**
 * Todos los viajes (o partes) de una cuenta, uno abajo del otro: a la izquierda lo que llevó cada
 * uno, a la derecha la deuda, lo que se cobró y el saldo. Es la planilla de liquidación de camiones
 * que se llevaba en el Excel.
 */
export default async function ViajesJuntosPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId: entityParam } = await params;
  await requireUser();

  const entity = await findBySlugOrId(
    () => prisma.entity.findUnique({ where: { slug: entityParam } }),
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
    <div className="space-y-8">
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
          <div className="text-right">
            <p className="text-xs text-foreground/50">Saldo de la cuenta</p>
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(saldoTotal, moneda)}</p>
          </div>
        </div>
      </div>

      {cuadros.map((c) => (
        <section key={c.id ?? "sin-asignar"} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-primary pb-2">
            <h2 className="text-base font-semibold">
              {c.id ? (
                <Link href={`/cuentas-corrientes/${entity.slug}/viaje/${c.id}`} className="underline-offset-2 hover:underline">
                  {c.nombre}
                </Link>
              ) : (
                c.nombre
              )}
              {c.destino && <span className="text-foreground/50"> · {c.destino}</span>}
              {c.remitos.length > 0 && (
                <span className="text-sm font-normal text-foreground/50">
                  {" "}
                  — {c.remitos.length === 1 ? "remito" : "remitos"} {c.remitos.join(" · ")}
                </span>
              )}
            </h2>
            <p className="text-sm">
              <span className="text-foreground/50">Saldo </span>
              <span
                className={`font-semibold tabular-nums ${
                  c.saldo.greaterThan(0) ? "text-amber-700 dark:text-amber-400" : c.saldo.isZero() ? "text-green-700 dark:text-green-400" : ""
                }`}
              >
                {formatMoney(c.saldo, moneda)}
              </span>
            </p>
          </div>

          <div className={c.renglones.length > 0 ? "grid gap-4 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" : ""}>
            {c.renglones.length > 0 && (
              <div className="min-w-0 overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-foreground/10">
                      <th className={th}>Fecha</th>
                      <th className={th}>Vencimiento</th>
                      <th className={th}>Remito</th>
                      <th className={th}>Marca</th>
                      <th className={th}>Formato</th>
                      <th className={`${th} text-right`}>Pallets</th>
                      <th className={`${th} text-right`}>Unidades</th>
                      <th className={`${th} text-right`}>Precio unit.</th>
                      <th className={`${th} text-right`}>Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.renglones.map((r) => (
                      <tr key={r.id} className={`border-b border-foreground/5 ${r.devolucion ? "text-red-700 dark:text-red-400" : ""}`}>
                        <td className={td}>{formatFecha(r.fecha)}</td>
                        <td className={`${td} text-foreground/60`}>{r.vencimiento ? formatFecha(r.vencimiento) : "—"}</td>
                        <td className={td}>
                          {r.devolucion ? "Dev. " : "#"}
                          {r.remito}
                          {r.circuito === "BLANCO" && <span className="ml-1 text-xs text-foreground/50">C1</span>}
                        </td>
                        <td className={td}>{formatProductBrandLabel(r.marca)}</td>
                        <td className={td}>{r.formato}</td>
                        <td className={tdNum}>
                          {r.pallets > 0 && formatQuantity(r.pallets)}
                          {r.cajas > 0 && <span className="text-foreground/60">{r.pallets > 0 ? " + " : ""}{formatQuantity(r.cajas)} cj</span>}
                          {r.botellas > 0 && <span className="text-foreground/60"> + {formatQuantity(r.botellas)} bot</span>}
                        </td>
                        <td className={tdNum}>{formatQuantity(r.unidades)}</td>
                        <td className={tdNum}>{r.precioUnitario ? formatMoney(r.precioUnitario, moneda) : "—"}</td>
                        <td className={`${tdNum} font-medium`}>{formatMoney(r.importe, moneda)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={8} className={`${td} text-right font-semibold`}>
                        Total {rotulo.toLowerCase()}
                      </td>
                      <td className={`${tdNum} font-semibold`}>
                        {formatMoney(sumDecimals(c.renglones.map((r) => r.importe)), moneda)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="min-w-0 overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-foreground/10">
                    <th className={th}>Fecha</th>
                    <th className={th}>Detalle</th>
                    <th className={`${th} text-right`}>Monto</th>
                    <th className={`${th} text-right`}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {c.movimientos.map((m) => {
                    const doc = m.documento;
                    const detalle = doc
                      ? doc.type === "REMITO"
                        ? `Deuda · remito #${doc.number}`
                        : doc.type === "NOTA_CREDITO" && doc.reason?.startsWith("Devolución")
                          ? `Devolución #${doc.number}`
                          : doc.type === "AJUSTE" && doc.number.startsWith("SALDO-INICIAL")
                            ? "Saldo inicial"
                            : `${DOCUMENT_TYPE_LABELS[doc.type]} #${doc.number}`
                      : `${m.pago ? PAYMENT_METHOD_LABELS[m.pago.method] : "Cobro"}${m.detalle ? ` · ${m.detalle}` : ""}`;
                    return (
                      <tr key={`${m.tipo}-${m.id}`} className="border-b border-foreground/5 last:border-0">
                        <td className={td}>{formatFecha(m.fecha)}</td>
                        <td className="py-1.5 px-3">
                          {detalle}
                          {doc?.destinatario && <span className="text-foreground/50"> — {doc.destinatario.nombre}</span>}
                        </td>
                        <td className={`${tdNum} ${m.monto.isNegative() ? "text-green-700 dark:text-green-400" : ""}`}>
                          {formatMoney(m.monto, moneda)}
                        </td>
                        <td className={`${tdNum} font-medium`}>{formatMoney(m.saldo, moneda)}</td>
                      </tr>
                    );
                  })}
                  {c.movimientos.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-foreground/40">
                        Sin movimientos todavía.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ))}

      {cuadros.length === 0 && (
        <p className="rounded-xl border border-foreground/10 bg-background px-4 py-8 text-center text-foreground/40 shadow-sm">
          Esta cuenta todavía no tiene {plural.toLowerCase()}. Se cargan desde la ficha.
        </p>
      )}
    </div>
  );
}
