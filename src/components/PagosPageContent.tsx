import Link from "next/link";
import type { EntityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getRecentPayments, getTreasuries } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { FormModal } from "./Modal";
import { DeleteButton } from "./DeleteButton";
import { PaymentFormFields } from "./PaymentFormFields";
import { PROVEEDOR_DIRECTO_VALUE } from "@/lib/payment-destino";
import { EditPaymentFields } from "./EditPaymentFields";
import {
  createPaymentForEntity,
  deletePayment,
  updatePayment,
} from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { toDateInputValue } from "@/lib/period";

export async function PagosPageContent({
  typeFilter,
  title,
  entityNoun,
}: {
  typeFilter: EntityType[];
  title: string;
  entityNoun: string;
}) {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";
  const isCobro = entityNoun === "Cliente";

  const [entities, pagos, treasuries, proveedores] = await Promise.all([
    prisma.entity.findMany({ where: { type: { in: typeFilter } }, orderBy: { name: "asc" } }),
    getRecentPayments(typeFilter, 30),
    getTreasuries(),
    isCobro
      ? prisma.entity.findMany({ where: { type: { in: ["PROVEEDOR", "AMBOS"] } }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  const linkedPaymentIds = pagos.map((p) => p.linkedPaymentId).filter((id): id is string => !!id);
  const linkedPayments = linkedPaymentIds.length
    ? await prisma.payment.findMany({
        where: { id: { in: linkedPaymentIds } },
        include: { account: { include: { entity: true } } },
      })
    : [];
  const linkedPaymentById = new Map(linkedPayments.map((p) => [p.id, p]));
  const treasuryById = new Map(treasuries.map((t) => [t.id, t]));

  return (
    <div className="space-y-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold mb-1">{title}</h1>
          <p className="text-sm text-foreground/60">Últimos pagos registrados.</p>
        </div>
        {canEdit && (
          <FormModal
            triggerLabel="Nuevo pago"
            title="Registrar pago"
            action={createPaymentForEntity}
            maxWidthClass="max-w-xl"
          >
            <PaymentFormFields
              entities={entities}
              entityNoun={entityNoun}
              treasuries={treasuries}
              proveedores={isCobro ? proveedores : undefined}
            />
          </FormModal>
        )}
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Últimos pagos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">{entityNoun}</th>
                <th className="py-2 pr-4">Monto</th>
                <th className="py-2 pr-4">Medio</th>
                <th className="py-2 pr-4">{isCobro ? "Destino" : "Origen"}</th>
                <th className="py-2 pr-4">Descripción</th>
                <th className="py-2 pr-4">Fecha</th>
                {canEdit && <th className="py-2 pr-4">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {pagos.map((payment) => {
                const linkedPayment = payment.linkedPaymentId
                  ? linkedPaymentById.get(payment.linkedPaymentId)
                  : undefined;
                const destinoLabel = payment.treasuryId
                  ? treasuryById.get(payment.treasuryId)?.name
                  : linkedPayment
                    ? `Directo a ${linkedPayment.account.entity.name}`
                    : null;
                const defaultDestino = payment.treasuryId ?? (linkedPayment ? PROVEEDOR_DIRECTO_VALUE : "");
                return (
                  <tr key={payment.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${payment.account.entity.slug}`}
                        className="underline underline-offset-2"
                      >
                        {payment.account.entity.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{formatMoney(payment.amount, payment.currency)}</td>
                    <td className="py-2 pr-4">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                    <td className="py-2 pr-4">{destinoLabel ?? "—"}</td>
                    <td className="py-2 pr-4">{payment.reference ?? "—"}</td>
                    <td className="py-2 pr-4">{payment.date.toLocaleDateString("es-AR")}</td>
                    {canEdit && (
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <FormModal
                            triggerLabel="Editar"
                            iconName="edit"
                            title="Editar pago"
                            action={updatePayment}
                            maxWidthClass="max-w-xl"
                          >
                            <EditPaymentFields
                              paymentId={payment.id}
                              treasuries={treasuries}
                              proveedores={isCobro ? proveedores : undefined}
                              defaultValues={{
                                circuit: payment.account.circuit,
                                method: payment.method,
                                date: toDateInputValue(payment.date),
                                amount: payment.amount.toString(),
                                reference: payment.reference ?? undefined,
                                destino: defaultDestino,
                                proveedorId: linkedPayment?.account.entityId,
                              }}
                            />
                          </FormModal>
                          <DeleteButton
                            action={deletePayment}
                            hiddenName="paymentId"
                            hiddenValue={payment.id}
                            confirmMessage="¿Borrar este pago? Esta acción no se puede deshacer."
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {pagos.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="py-6 text-center text-foreground/40">
                    Todavía no hay pagos cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
