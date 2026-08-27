import type { PedidoPendiente } from "@/lib/pedidos";
import { formatProductBrandLabel } from "@/lib/product-label";
import { formatQuantity } from "@/lib/money";
import { PEDIDO_STATUS_LABELS } from "@/lib/labels";

export function PedidoLinkChecklist({ pedidosPendientes }: { pedidosPendientes: PedidoPendiente[] }) {
  if (pedidosPendientes.length === 0) return null;

  return (
    <div className="space-y-2 rounded border border-black/10 p-3">
      <p className="text-sm font-medium">¿Este remito entrega alguno de estos pedidos?</p>
      <p className="text-xs text-black/50">
        Los que tildes se marcan como &quot;Entregado&quot; automáticamente al crear el remito.
      </p>
      <div className="space-y-1">
        {pedidosPendientes.map((pedido) => (
          <label key={pedido.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="pedidoId" value={pedido.id} className="mt-1" />
            <span>
              #{pedido.orderNumber} — {PEDIDO_STATUS_LABELS[pedido.status]} —{" "}
              {pedido.lines
                .map(
                  (l) => `${formatProductBrandLabel(l.product)} (${formatQuantity(l.pallets, "pallets")})`
                )
                .join(", ")}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
