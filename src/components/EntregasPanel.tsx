import type { Product } from "@prisma/client";
import type { getRecentRemitos } from "@/lib/ledger";
import type { PedidoPendiente } from "@/lib/pedidos";
import { formatMoney } from "@/lib/money";
import { formatProductLabel } from "@/lib/product-label";
import { createRemito } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { FormModal } from "./Modal";
import { RemitoFormFields } from "./RemitoForm";

export function EntregasPanel({
  entityId,
  products,
  priceMapByCircuit,
  remitos,
  canEdit,
  pedidosPendientes,
}: {
  entityId: string;
  products: Product[];
  priceMapByCircuit: Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>>;
  remitos: Awaited<ReturnType<typeof getRecentRemitos>>;
  canEdit: boolean;
  pedidosPendientes?: PedidoPendiente[];
}) {
  return (
    <div className="rounded-lg border border-black/10 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Entregas</h2>
        {canEdit && (
          <FormModal
            triggerLabel="+ Nueva"
            title="Nuevo remito"
            action={createRemito}
            maxWidthClass="max-w-2xl"
          >
            <RemitoFormFields
              entityId={entityId}
              products={products}
              priceMapByCircuit={priceMapByCircuit}
              pedidosPendientes={pedidosPendientes}
            />
          </FormModal>
        )}
      </div>

      <div className="space-y-2">
        {remitos.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between border-b border-black/5 pb-2">
            <div>
              <p className="text-sm font-medium">Remito #{doc.number}</p>
              <p className="text-xs text-black/50">
                {doc.date.toLocaleDateString("es-AR")} ·{" "}
                {doc.lines.map((l) => formatProductLabel(l.product)).join(", ") || "—"}
              </p>
            </div>
            <p className="text-sm font-semibold">{formatMoney(doc.totalAmount, doc.currency)}</p>
          </div>
        ))}
        {remitos.length === 0 && (
          <p className="py-4 text-center text-sm text-black/40">Todavía no hay entregas.</p>
        )}
      </div>
    </div>
  );
}
