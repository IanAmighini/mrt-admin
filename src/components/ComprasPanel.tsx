import type { Item } from "@prisma/client";
import type { getRecentCompras } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { createCompra } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { FormModal } from "./Modal";
import { CompraFormFields } from "./CompraForm";

export function ComprasPanel({
  entityId,
  items,
  compras,
  canEdit,
}: {
  entityId: string;
  items: Item[];
  compras: Awaited<ReturnType<typeof getRecentCompras>>;
  canEdit: boolean;
}) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Compras</h2>
        {canEdit && (
          <FormModal
            triggerLabel="Nueva compra"
            title="Nueva compra de insumos"
            action={createCompra}
            maxWidthClass="max-w-2xl"
          >
            <CompraFormFields entityId={entityId} items={items} />
          </FormModal>
        )}
      </div>

      <div className="space-y-2">
        {compras.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between border-b border-foreground/5 pb-2">
            <div>
              <p className="text-sm font-medium">Remito #{doc.number}</p>
              <p className="text-xs text-foreground/50">
                {doc.date.toLocaleDateString("es-AR")} ·{" "}
                {doc.purchaseLines.map((l) => l.item.name).join(", ") || "—"}
              </p>
            </div>
            <p className="text-sm font-semibold">{formatMoney(doc.totalAmount, doc.currency)}</p>
          </div>
        ))}
        {compras.length === 0 && (
          <p className="py-4 text-center text-sm text-foreground/40">Todavía no hay compras.</p>
        )}
      </div>
    </div>
  );
}
