import Link from "next/link";
import type { EntityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAccountDocuments, getRecentPayments } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { CIRCUIT_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { PaymentForm } from "./PaymentForm";

export async function PagosPageContent({
  typeFilter,
  title,
  entityNoun,
  entityId,
}: {
  typeFilter: EntityType[];
  title: string;
  entityNoun: string;
  entityId?: string;
}) {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [entities, pagos] = await Promise.all([
    prisma.entity.findMany({ where: { type: { in: typeFilter } }, orderBy: { name: "asc" } }),
    getRecentPayments(typeFilter, 30),
  ]);

  const selectedEntity = entityId ? entities.find((e) => e.id === entityId) : undefined;

  const accounts = selectedEntity
    ? await prisma.account.findMany({ where: { entityId: selectedEntity.id } })
    : [];
  const documentsPerAccount = await Promise.all(accounts.map((a) => getAccountDocuments(a.id)));
  const documentsByAccount = new Map(accounts.map((a, i) => [a.id, documentsPerAccount[i]]));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">{title}</h1>
        <p className="text-sm text-black/60">
          Registrar un pago eligiendo {entityNoun.toLowerCase() === "cliente" ? "el cliente" : "el proveedor"} directamente acá.
        </p>
      </div>

      {canEdit && (
        <form className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-4">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="entityId">
              {entityNoun}
            </label>
            <select
              id="entityId"
              name="entityId"
              defaultValue={selectedEntity?.id ?? ""}
              className="w-64 rounded border border-black/20 px-3 py-2 text-sm"
            >
              <option value="">— Elegir {entityNoun.toLowerCase()} —</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Elegir
          </button>
        </form>
      )}

      {canEdit && selectedEntity && accounts.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {accounts.map((account) => (
            <div key={account.id} className="space-y-2">
              <h2 className="text-sm font-semibold">Circuito {CIRCUIT_LABELS[account.circuit]}</h2>
              <PaymentForm
                accountId={account.id}
                pendingDocuments={documentsByAccount.get(account.id) ?? []}
              />
            </div>
          ))}
        </div>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2">Últimos pagos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">{entityNoun}</th>
                <th className="py-2 pr-4">Monto</th>
                <th className="py-2 pr-4">Medio</th>
                <th className="py-2 pr-4">Referencia</th>
                <th className="py-2 pr-4">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((payment) => (
                <tr key={payment.id} className="border-b border-black/5">
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
                  <td className="py-2 pr-4">{payment.reference ?? "—"}</td>
                  <td className="py-2 pr-4">{payment.date.toLocaleDateString("es-AR")}</td>
                </tr>
              ))}
              {pagos.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-black/40">
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
