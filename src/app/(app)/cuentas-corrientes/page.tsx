import Link from "next/link";
import { getEntitySaldos, getVencimientos } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { DOCUMENT_TYPE_LABELS } from "@/lib/labels";

export default async function CuentasCorrientesPage() {
  const [rows, vencimientos] = await Promise.all([getEntitySaldos(), getVencimientos()]);
  const today = new Date();

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Cuentas corrientes</h1>
        <p className="text-sm text-black/60">
          Saldo pendiente por entidad, circuito Blanco y Negro. Ordenado por mayor deuda.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-black/60">
              <th className="py-2 pr-4">Entidad</th>
              <th className="py-2 pr-4">Saldo Blanco</th>
              <th className="py-2 pr-4">Saldo Negro</th>
              <th className="py-2 pr-4">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entity, blancoSaldo, negroSaldo, total }) => (
              <tr key={entity.id} className="border-b border-black/5">
                <td className="py-2 pr-4">
                  <Link href={`/cuentas-corrientes/${entity.id}`} className="underline underline-offset-2">
                    {entity.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{blancoSaldo ? formatMoney(blancoSaldo) : "—"}</td>
                <td className="py-2 pr-4">{negroSaldo ? formatMoney(negroSaldo) : "—"}</td>
                <td className="py-2 pr-4 font-medium">{formatMoney(total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-black/40">
                  Todavía no hay entidades cargadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Vencimientos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Entidad</th>
                <th className="py-2 pr-4">Comprobante</th>
                <th className="py-2 pr-4">Vencimiento</th>
                <th className="py-2 pr-4">Pendiente</th>
                <th className="py-2 pr-4">Estado</th>
              </tr>
            </thead>
            <tbody>
              {vencimientos.map((doc) => {
                const vencido = doc.dueDate && doc.dueDate < today;
                return (
                  <tr key={doc.id} className="border-b border-black/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${doc.account.entityId}`}
                        className="underline underline-offset-2"
                      >
                        {doc.account.entity.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      {DOCUMENT_TYPE_LABELS[doc.type]} #{doc.number}
                    </td>
                    <td className="py-2 pr-4">
                      {doc.dueDate?.toLocaleDateString("es-AR")}
                    </td>
                    <td className="py-2 pr-4">{formatMoney(doc.pending, doc.currency)}</td>
                    <td className="py-2 pr-4">
                      <span className={vencido ? "text-red-600 font-medium" : "text-black/60"}>
                        {vencido ? "Vencido" : "Por vencer"}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {vencimientos.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-black/40">
                    No hay comprobantes con vencimiento pendiente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
