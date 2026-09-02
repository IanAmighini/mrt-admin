import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { getEntitySaldos } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { FormModal } from "@/components/Modal";
import { EntityFormFields } from "@/components/EntityFormFields";
import { createEntity } from "../clientes/actions";

const TYPE_LABELS: Record<string, string> = {
  CLIENTE: "Cliente",
  PROVEEDOR: "Proveedor",
  AMBOS: "Cliente y proveedor",
};

export default async function ProveedoresPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const rows = await getEntitySaldos(["PROVEEDOR", "AMBOS"]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold mb-1">Proveedores</h1>
          <p className="text-sm text-foreground/60">
            Cada proveedor recibe automáticamente dos cuentas corrientes independientes: Blanco y
            Negro.
          </p>
        </div>
        {canEdit && (
          <FormModal triggerLabel="Nuevo proveedor" title="Nuevo proveedor" action={createEntity}>
            <EntityFormFields defaultType="PROVEEDOR" showSupplierCategory />
          </FormModal>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Nombre</th>
              <th className="py-2 pr-4">Tipo</th>
              <th className="py-2 pr-4">Tipo de insumo</th>
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
                    href={`/cuentas-corrientes/${entity.slug}`}
                    className="underline underline-offset-2"
                  >
                    {entity.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{TYPE_LABELS[entity.type]}</td>
                <td className="py-2 pr-4">
                  {entity.supplierCategory ? SUPPLIER_CATEGORY_LABELS[entity.supplierCategory] : "—"}
                </td>
                <td className="py-2 pr-4">{entity.taxId || "—"}</td>
                <td className="py-2 pr-4">{blancoSaldo ? formatMoney(blancoSaldo) : "—"}</td>
                <td className="py-2 pr-4">{negroSaldo ? formatMoney(negroSaldo) : "—"}</td>
                <td className="py-2 pr-4 font-medium">{formatMoney(total)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-foreground/40">
                  Todavía no hay proveedores cargados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
