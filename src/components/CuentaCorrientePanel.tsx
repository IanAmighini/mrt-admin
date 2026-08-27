import type { RecentMovement } from "@/lib/ledger";
import { getDocumentEffect } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import {
  createDocumentForEntity,
  createPaymentForEntity,
} from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { FormModal } from "./Modal";
import { PaymentFormFields } from "./PaymentFormFields";
import { DocumentFormFields } from "./DocumentFormFields";

export function CuentaCorrientePanel({
  entityId,
  movements,
  canEdit,
}: {
  entityId: string;
  movements: RecentMovement[];
  canEdit: boolean;
}) {
  return (
    <div className="rounded-lg border border-black/10 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Cuenta corriente</h2>
        {canEdit && (
          <div className="flex gap-3">
            <FormModal triggerLabel="Registrar pago" title="Registrar pago" action={createPaymentForEntity}>
              <PaymentFormFields fixedEntityId={entityId} />
            </FormModal>
            <FormModal triggerLabel="+ Movimiento" title="Nuevo movimiento" action={createDocumentForEntity}>
              <DocumentFormFields fixedEntityId={entityId} />
            </FormModal>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {movements.map((movement) =>
          movement.kind === "document" ? (
            <div
              key={movement.document.id}
              className="flex items-center justify-between border-b border-black/5 pb-2"
            >
              <div>
                <p className="text-sm font-medium">
                  {DOCUMENT_TYPE_LABELS[movement.document.type]} #{movement.document.number}
                </p>
                <p className="text-xs text-black/50">{movement.date.toLocaleDateString("es-AR")}</p>
              </div>
              <p className="text-sm font-semibold">
                {formatMoney(getDocumentEffect(movement.document), movement.document.currency)}
              </p>
            </div>
          ) : (
            <div
              key={movement.payment.id}
              className="flex items-center justify-between border-b border-black/5 pb-2"
            >
              <div>
                <p className="text-sm font-medium">
                  Pago — {PAYMENT_METHOD_LABELS[movement.payment.method]}
                </p>
                <p className="text-xs text-black/50">{movement.date.toLocaleDateString("es-AR")}</p>
              </div>
              <p className="text-sm font-semibold text-green-700">
                {formatMoney(movement.payment.amount, movement.payment.currency)}
              </p>
            </div>
          )
        )}
        {movements.length === 0 && (
          <p className="py-4 text-center text-sm text-black/40">Sin movimientos.</p>
        )}
      </div>
    </div>
  );
}
