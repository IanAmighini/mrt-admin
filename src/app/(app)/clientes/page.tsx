import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { getEntitySaldos } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { FormModal } from "@/components/Modal";
import { EntityFormFields } from "@/components/EntityFormFields";
import { createEntity } from "./actions";

const TYPE_LABELS: Record<string, string> = {
  CLIENTE: "Cliente",
  PROVEEDOR: "Proveedor",
  AMBOS: "Cliente y proveedor",
};

export default async function ClientesPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const rows = await getEntitySaldos(["CLIENTE", "AMBOS"]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold mb-1">Clientes</h1>
          <p className="text-sm text-foreground/60">
            Cada cliente recibe automáticamente dos cuentas corrientes independientes: Blanco y
            Negro.
          </p>
        </div>
        {canEdit && (
          <FormModal triggerLabel="Nuevo cliente" title="Nuevo cliente" action={createEntity}>
            <EntityFormFields defaultType="CLIENTE" />
          </FormModal>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Nombre</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">CUIT</th>
              <th className="py-2 pr-4">Saldo Blanco</th>
              <th className="py-2 pr-4">Saldo Negro</th>
              <th className="py-2 pr-4">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entity, blancoSaldo, negroSaldo, total }) => (
              <tr key={entity.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4">
                  <Link
                    href={`/cuentas-corrientes/${entity.id}`}
                    className="underline underline-offset-2"
                  >
                    {entity.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{TYPE_LABELS[entity.type]}</td>
                <td className="py-2 pr-4">{entity.taxId || "—"}</td>
                <td className="py-2 pr-4">{blancoSaldo ? formatMoney(blancoSaldo) : "—"}</td>
                <td className="py-2 pr-4">{negroSaldo ? formatMoney(negroSaldo) : "—"}</td>
                <td className="py-2 pr-4 font-medium">{formatMoney(total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-foreground/40">
                  Todavía no hay clientes cargados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
