import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getCurrentPricesForAccount } from "@/lib/pricing";
import { getPedidosPendientesByEntity } from "@/lib/pedidos";
import { createRemito } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { RemitoFormFields } from "@/components/RemitoForm";

async function submitRemito(formData: FormData) {
  "use server";
  await createRemito(formData);
  redirect("/entregas");
}

export default async function NuevaEntregaPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string }>;
}) {
  const { entityId } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const clientes = await prisma.entity.findMany({
    where: { type: { in: ["CLIENTE", "AMBOS"] } },
    orderBy: { name: "asc" },
  });
  const selectedEntity = entityId ? clientes.find((c) => c.id === entityId) : undefined;

  let priceMapByCircuit: Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>> | null =
    null;
  let products: Awaited<ReturnType<typeof prisma.product.findMany>> = [];
  let pedidosPendientes: Awaited<ReturnType<typeof getPedidosPendientesByEntity>> = [];

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
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/entregas" className="text-sm underline underline-offset-2">
          ← Volver a entregas
        </Link>
        <h1 className="text-xl font-semibold mt-2">Nueva entrega</h1>
      </div>

      {!canEdit && <p className="text-sm text-black/60">No tenés permisos para cargar entregas.</p>}

      {canEdit && (
        <div className="rounded-lg border border-black/10 p-4 space-y-3">
          <h2 className="text-sm font-semibold">Información general</h2>
          <form className="flex flex-wrap items-end gap-3">
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
              {selectedEntity ? "Cambiar cliente" : "Elegir"}
            </button>
          </form>
        </div>
      )}

      {canEdit && selectedEntity && priceMapByCircuit && (
        <form action={submitRemito} className="rounded-lg border border-black/10 p-4 space-y-4">
          <h2 className="text-sm font-semibold">Detalles de la entrega</h2>
          <RemitoFormFields
            entityId={selectedEntity.id}
            products={products}
            priceMapByCircuit={priceMapByCircuit}
            pedidosPendientes={pedidosPendientes}
          />
        </form>
      )}
    </div>
  );
}
