"use client";

import { useActionState } from "react";
import type { PedidoStatus } from "@prisma/client";
import { PEDIDO_STATUS_COLORS, PEDIDO_STATUS_LABELS } from "@/lib/labels";
import { updatePedidoStatus } from "@/app/(app)/pedidos/actions";

const STATUSES: PedidoStatus[] = ["EN_COLA", "COMPLETADO", "ENTREGADO"];

export function PedidoStatusSelect({ pedidoId, status }: { pedidoId: string; status: PedidoStatus }) {
  const [error, formAction, pending] = useActionState<string | null, FormData>(
    async (_prevState, formData) => {
      try {
        await updatePedidoStatus(formData);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Ocurrió un error.";
      }
    },
    null
  );

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="pedidoId" value={pedidoId} />
        <select
          key={status}
          name="status"
          defaultValue={status}
          disabled={pending}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className={`rounded border-0 px-2 py-1 text-xs font-medium disabled:opacity-50 ${PEDIDO_STATUS_COLORS[status]}`}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {PEDIDO_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </form>
      {error && <p className="mt-1 max-w-xs text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
