import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getRecentRemitos } from "@/lib/ledger";
import { getCurrentPricesForAccount } from "@/lib/pricing";
import { getPedidosPendientesByEntity, type PedidoPendiente } from "@/lib/pedidos";
import { formatMoney, formatQuantity } from "@/lib/money";
import { formatProductLabel } from "@/lib/product-label";
import { RemitoForm } from "@/components/RemitoForm";

export default async function EntregasPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string }>;
}) {
  const { entityId } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [clientes, entregas] = await Promise.all([
    prisma.entity.findMany({
      where: { type: { in: ["CLIENTE", "AMBOS"] } },
      orderBy: { name: "asc" },
    }),
    getRecentRemitos(30),
  ]);

  const selectedEntity = entityId
    ? clientes.find((c) => c.id === entityId)
    : undefined;

  let priceMapByCircuit: Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>> | null =
    null;
  let products: Awaited<ReturnType<typeof prisma.product.findMany>> = [];
  let pedidosPendientes: PedidoPendiente[] = [];

  if (selectedEntity) {
    const [blancoPrices, negroPrices, allProducts, pendientes] = await Promise.all([
      getCurrentPricesForAccount(selectedEntity.id, "BLANCO"),
      getCurrentPricesForAccount(selectedEntity.id, "NEGRO"),
      prisma.product.findMany({ orderBy: { name: "asc" } }),
      getPedidosPendientesByEntity(selectedEntity.id),
    ]);
    products = allProducts;
    pedidosPendientes = pendientes;
    priceMapByCircuit = { BLANCO: {}, NEGRO: {} };
    for (const [productId, price] of blancoPrices) {
      priceMapByCircuit.BLANCO[productId] = { amount: price.amount.toNumber(), currency: price.currency };
    }
    for (const [productId, price] of negroPrices) {
      priceMapByCircuit.NEGRO[productId] = { amount: price.amount.toNumber(), currency: price.currency };
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Entregas</h1>
        <p className="text-sm text-black/60">
          Cargar una entrega (remito) a un cliente, eligiéndolo directamente acá.
        </p>
      </div>

      {canEdit && (
        <form className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-4">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="entityId">
              Cliente
            </label>
            <select
              id="entityId"
              name="entityId"
              defaultValue={selectedEntity?.id ?? ""}
              className="w-64 rounded border border-black/20 px-3 py-2 text-sm"
            >
              <option value="">— Elegir cliente —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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

      {canEdit && selectedEntity && priceMapByCircuit && (
        <RemitoForm
          entityId={selectedEntity.id}
          products={products}
          priceMapByCircuit={priceMapByCircuit}
          pedidosPendientes={pedidosPendientes}
        />
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2">Últimas entregas</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Cliente</th>
                <th className="py-2 pr-4">Remito</th>
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Total</th>
              </tr>
            </thead>
            <tbody>
              {entregas.map((doc) => (
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
                    #{doc.number}
                    <p className="text-xs font-normal text-black/50">
                      {doc.lines
                        .map((l) => `${formatProductLabel(l.product)} × ${formatQuantity(l.quantity)}`)
                        .join(" · ")}
                    </p>
                  </td>
                  <td className="py-2 pr-4">{doc.date.toLocaleDateString("es-AR")}</td>
                  <td className="py-2 pr-4">{formatMoney(doc.totalAmount, doc.currency)}</td>
                </tr>
              ))}
              {entregas.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-black/40">
                    Todavía no hay entregas cargadas.
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
