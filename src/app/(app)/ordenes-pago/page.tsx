import Link from "next/link";
import { ChevronRight, FileText } from "lucide-react";
import { formatFecha } from "@/lib/period";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney, sumDecimals } from "@/lib/money";
import { DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatNumeroOP } from "@/lib/orden-pago";
import { ETIQUETA } from "@/components/Etiquetas";

/**
 * Las órdenes de pago emitidas, la última arriba. Cada una dice de un vistazo a quién, por qué
 * medios —con cuántos cheques— y qué comprobantes cancela, y se abre para imprimirla.
 */
export default async function OrdenesPagoPage() {
  await requireRole(["ADMIN", "SOLO_LECTURA", "SECRETARIA"]);

  const ordenes = await prisma.ordenPago.findMany({
    include: {
      entity: true,
      payments: {
        include: {
          chequesEntregados: { select: { id: true, esEcheq: true } },
          allocations: { include: { document: { select: { id: true, number: true, type: true } } } },
        },
      },
    },
    orderBy: { numero: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Órdenes de pago</h1>
        <p className="text-sm text-foreground/60">
          El papel que firma el proveedor. Se genera desde su ficha con el botón <strong className="font-medium">Orden de pago</strong>,
          agrupando pagos ya cargados de la Cuenta 1 (c/factura).
        </p>
      </div>

      <div className="divide-y divide-foreground/10 rounded-xl border border-foreground/10 bg-background shadow-sm">
        {ordenes.map((o) => {
          const total = sumDecimals(o.payments.map((p) => p.amount));
          const vacia = o.payments.length === 0;
          // Los medios, con los cheques contados: "5 echeqs" dice más que "Echeq".
          const medios = Array.from(new Set(o.payments.map((p) => p.method))).map((m) => {
            const cheques = o.payments.filter((p) => p.method === m).flatMap((p) => p.chequesEntregados);
            if ((m === "CHEQUE" || m === "ECHEQ") && cheques.length > 1) {
              return `${cheques.length} ${m === "ECHEQ" ? "echeqs" : "cheques"}`;
            }
            return PAYMENT_METHOD_LABELS[m];
          });
          const comprobantes = Array.from(
            new Map(o.payments.flatMap((p) => p.allocations.map((a) => [a.document.id, a.document]))).values()
          );
          return (
            <Link
              key={o.id}
              href={`/ordenes-pago/${o.numero}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-foreground/[0.03]"
            >
              <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/20 leading-none">
                <FileText size={14} className="text-foreground/50" />
                <span className="mt-0.5 text-[11px] font-semibold tabular-nums">{formatNumeroOP(o.numero)}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {o.entity.name} <span className="font-normal text-foreground/50">· {formatFecha(o.date)}</span>
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {vacia ? (
                    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      Sin pagos
                    </span>
                  ) : (
                    medios.map((m) => (
                      <span key={m} className={ETIQUETA}>
                        {m}
                      </span>
                    ))
                  )}
                  {comprobantes.map((d) => (
                    <span key={d.id} className={ETIQUETA}>
                      {d.number === "SALDO-INICIAL" ? "Saldo inicial" : `${DOCUMENT_TYPE_LABELS[d.type]} #${d.number}`}
                    </span>
                  ))}
                </div>
              </div>
              <p className={`shrink-0 text-right font-semibold tabular-nums sm:text-lg ${vacia ? "text-foreground/40" : ""}`}>
                {formatMoney(total)}
              </p>
              <ChevronRight size={18} className="shrink-0 text-foreground/30" />
            </Link>
          );
        })}
        {ordenes.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-foreground/40">
            Todavía no hay órdenes de pago. Se generan desde la ficha del proveedor.
          </p>
        )}
      </div>
    </div>
  );
}
