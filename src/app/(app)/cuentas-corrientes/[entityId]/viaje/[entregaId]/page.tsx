import Link from "next/link";
import { formatFecha } from "@/lib/period";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { getEntregaDetalle } from "@/lib/entregas";
import { formatMoney } from "@/lib/money";
import { CIRCUIT_LABELS, DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { generoDe } from "@/components/ViajeFields";

/**
 * El cuadro de un viaje: lo que se le cargó, lo que pagó y el saldo que queda, en una sola
 * pantalla. Es el reemplazo del cuadro de la planilla, y por eso mezcla las dos cuentas — un
 * camión lleva remitos en negro y facturas en blanco, y el saldo del viaje es uno solo.
 */
export default async function ViajePage({
  params,
}: {
  params: Promise<{ entityId: string; entregaId: string }>;
}) {
  const { entityId: entitySlug, entregaId } = await params;
  await requireUser();

  const detalle = await getEntregaDetalle(entregaId);
  if (!detalle) notFound();

  const { entrega, movimientos, total, cobrado, saldo } = detalle;
  const moneda = entrega.entity.moneda;
  const rotulo = entrega.entity.rotuloSubcuenta ?? "Viaje";

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/cuentas-corrientes/${entitySlug}`} className="text-sm underline underline-offset-2">
          ← {entrega.entity.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">
              {entrega.nombre}
              {entrega.destino && <span className="text-foreground/50"> · {entrega.destino}</span>}
            </h1>
            <p className="text-sm text-foreground/60">
              {formatFecha(entrega.fecha)} · cargado por {entrega.createdBy.name}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-foreground/50">
              Saldo de {generoDe(rotulo).este} {rotulo.toLowerCase()}
            </p>
            <p
              className={`text-2xl font-semibold tabular-nums ${
                saldo.isNegative() ? "text-green-700 dark:text-green-400" : ""
              }`}
            >
              {formatMoney(saldo, moneda)}
            </p>
          </div>
        </div>
        {entrega.notas && <p className="mt-2 text-sm text-foreground/60">{entrega.notas}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tarjeta label="Cargado" valor={formatMoney(total, moneda)} />
        <Tarjeta label="Cobrado" valor={formatMoney(cobrado, moneda)} />
        <Tarjeta
          label="Pendiente"
          valor={formatMoney(saldo, moneda)}
          destacado={!saldo.isZero() && !saldo.isNegative()}
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 px-4">Fecha</th>
              <th className="py-2 px-4">Detalle</th>
              <th className="py-2 px-4">Cuenta</th>
              <th className="py-2 px-4">Vencimiento</th>
              <th className="py-2 px-4 text-right">Monto</th>
              <th className="py-2 px-4 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => {
              const doc = m.documento;
              return (
                <tr key={`${m.tipo}-${m.id}`} className="border-b border-foreground/5 last:border-0">
                  <td className="py-2 px-4 whitespace-nowrap">{formatFecha(m.fecha)}</td>
                  <td className="py-2 px-4">
                    {doc ? (
                      <>
                        <span className="font-medium">
                          {DOCUMENT_TYPE_LABELS[doc.type]} #{doc.number}
                        </span>
                        {doc.destinatario && (
                          <span className="text-foreground/60"> — {doc.destinatario.nombre}</span>
                        )}
                        {doc.reason && <span className="text-foreground/40"> · {doc.reason}</span>}
                      </>
                    ) : (
                      <>
                        <span className="font-medium">
                          Pago — {m.pago ? PAYMENT_METHOD_LABELS[m.pago.method] : ""}
                        </span>
                        {m.detalle && <span className="text-foreground/40"> · {m.detalle}</span>}
                      </>
                    )}
                  </td>
                  <td className="py-2 px-4 text-foreground/60">{CIRCUIT_LABELS[m.circuito]}</td>
                  <td className="py-2 px-4 text-foreground/60 whitespace-nowrap">
                    {doc?.dueDate ? formatFecha(doc.dueDate) : "—"}
                  </td>
                  <td
                    className={`py-2 px-4 text-right tabular-nums ${
                      m.monto.isNegative() ? "text-green-700 dark:text-green-400" : ""
                    }`}
                  >
                    {formatMoney(m.monto, moneda)}
                  </td>
                  <td className="py-2 px-4 text-right font-medium tabular-nums">
                    {formatMoney(m.saldo, moneda)}
                  </td>
                </tr>
              );
            })}
            {movimientos.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-foreground/40">
                  Todavía no hay nada acá. Los comprobantes y los pagos se asignan desde su propio
                  formulario, eligiendo &quot;{rotulo}&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tarjeta({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
      <p className="text-xs text-foreground/50">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${destacado ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {valor}
      </p>
    </div>
  );
}
