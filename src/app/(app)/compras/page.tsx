import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getRecentCompras } from "@/lib/ledger";
import { formatMoney, formatQuantity } from "@/lib/money";
import { CompraForm } from "@/components/CompraForm";

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string }>;
}) {
  const { entityId } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [proveedores, items, compras] = await Promise.all([
    prisma.entity.findMany({
      where: { type: { in: ["PROVEEDOR", "AMBOS"] } },
      orderBy: { name: "asc" },
    }),
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    getRecentCompras(30),
  ]);

  const selectedEntity = entityId ? proveedores.find((p) => p.id === entityId) : undefined;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Compras</h1>
        <p className="text-sm text-foreground/60">
          Cargar una compra de insumos a un proveedor, eligiéndolo directamente acá.
        </p>
      </div>

      {canEdit && (
        <form className="flex flex-wrap items-end gap-3 rounded-lg border border-foreground/10 p-4">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="entityId">
              Proveedor
            </label>
            <select
              id="entityId"
              name="entityId"
              defaultValue={selectedEntity?.id ?? ""}
              className="w-64 rounded border border-foreground/20 px-3 py-2 text-sm"
            >
              <option value="">— Elegir proveedor —</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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

      {canEdit && selectedEntity && <CompraForm entityId={selectedEntity.id} items={items} />}

      <section>
        <h2 className="text-sm font-semibold mb-2">Últimas compras</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Proveedor</th>
                <th className="py-2 pr-4">Remito</th>
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Total</th>
              </tr>
            </thead>
            <tbody>
              {compras.map((doc) => (
                <tr key={doc.id} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/cuentas-corrientes/${doc.account.entityId}`}
                      className="underline underline-offset-2"
                    >
                      {doc.account.entity.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    #{doc.number}
                    <p className="text-xs font-normal text-foreground/50">
                      {doc.purchaseLines
                        .map((l) => `${l.item.name} × ${formatQuantity(l.quantity)}`)
                        .join(" · ")}
                    </p>
                  </td>
                  <td className="py-2 pr-4">{doc.date.toLocaleDateString("es-AR")}</td>
                  <td className="py-2 pr-4">{formatMoney(doc.totalAmount, doc.currency)}</td>
                </tr>
              ))}
              {compras.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-foreground/40">
                    Todavía no hay compras cargadas.
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
