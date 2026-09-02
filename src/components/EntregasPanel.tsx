import Link from "next/link";
import { Plus } from "lucide-react";
import type { getRecentRemitos } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { formatProductLabel } from "@/lib/product-label";

export function EntregasPanel({
  entityId,
  remitos,
  canEdit,
}: {
  entityId: string;
  remitos: Awaited<ReturnType<typeof getRecentRemitos>>;
  canEdit: boolean;
}) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Entregas</h2>
        {canEdit && (
          <Link
            href={`/entregas/nueva?entityId=${entityId}`}
            className="flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            <Plus size={16} />
            Nueva entrega
          </Link>
        )}
      </div>

      <div className="space-y-2">
        {remitos.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between border-b border-foreground/5 pb-2">
            <div>
              <p className="text-sm font-medium">Remito #{doc.number}</p>
              <p className="text-xs text-foreground/50">
                {doc.date.toLocaleDateString("es-AR")} ·{" "}
                {doc.lines.map((l) => formatProductLabel(l.product)).join(", ") || "—"}
              </p>
            </div>
            <p className="text-sm font-semibold">{formatMoney(doc.totalAmount, doc.currency)}</p>
          </div>
        ))}
        {remitos.length === 0 && (
          <p className="py-4 text-center text-sm text-foreground/40">Todavía no hay entregas.</p>
        )}
      </div>
    </div>
  );
}
