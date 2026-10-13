import Link from "next/link";
import { formatFecha } from "@/lib/period";
import { Plus } from "lucide-react";
import { getDocumentPending, type getRecentRemitos } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { formatLineasDeRemito } from "@/lib/product-label";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { ETIQUETA, EstadoDePago } from "./Etiquetas";

export function EntregasPanel({
  entityId,
  entityName,
  remitos,
  canEdit,
}: {
  entityId: string;
  entityName: string;
  remitos: Awaited<ReturnType<typeof getRecentRemitos>>;
  canEdit: boolean;
}) {
  return (
    <section className="rounded-xl border border-foreground/10 bg-background shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-sm font-semibold">Últimas entregas</h2>
        <div className="flex items-center gap-3">
          <Link href={`/entregas?q=${encodeURIComponent(entityName)}`} className="text-xs text-foreground/50 hover:text-foreground">
            Ver todas
          </Link>
          {canEdit && (
            <Link
              href={`/entregas/nueva?entityId=${entityId}`}
              className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              <Plus size={15} />
              Nueva entrega
            </Link>
          )}
        </div>
      </div>

      <div className="divide-y divide-foreground/10 border-t border-foreground/10">
        {remitos.map((doc) => (
          <div key={doc.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Remito #{doc.number} <span className="font-normal text-foreground/50">· {formatFecha(doc.date)}</span>
              </p>
              {/* Pallets y cajas, que es como se habla de una entrega; el detalle por producto está en el remito. */}
              <p className="truncate text-xs text-foreground/50">{formatLineasDeRemito(doc.lines) || "—"}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className={ETIQUETA}>{CIRCUIT_LABELS[doc.account.circuit].split(" (")[0]}</span>
                <EstadoDePago pendiente={getDocumentPending(doc)} total={doc.totalAmount} moneda={doc.currency} verbo="Cobrado" />
              </div>
            </div>
            <p className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(doc.totalAmount, doc.currency)}</p>
          </div>
        ))}
        {remitos.length === 0 && <p className="px-4 py-6 text-center text-sm text-foreground/40">Todavía no hay entregas.</p>}
      </div>
    </section>
  );
}
