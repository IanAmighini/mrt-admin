import Link from "next/link";
import type { EntityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getRecentPayments, getTreasuries } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { FormModal } from "./Modal";
import { PaymentFormFields } from "./PaymentFormFields";
import { createPaymentForEntity } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";

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
                return (
                  <tr key={payment.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${payment.account.entityId}`}
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
                  </tr>
                );
              })}
              {pagos.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-foreground/40">
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
