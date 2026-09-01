import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllCurrentPrices } from "@/lib/pricing";
import { getAllPedidosPendientes } from "@/lib/pedidos";
import { formatProductBrandLabel } from "@/lib/product-label";
import { createRemito } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { NuevaEntregaForm } from "@/components/NuevaEntregaForm";

async function submitRemito(formData: FormData) {
  "use server";
  await createRemito(formData);
  redirect("/entregas");
}

export default async function NuevaEntregaPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [clientes, products, allPrices, allPedidos] = await Promise.all([
    prisma.entity.findMany({
      where: { type: { in: ["CLIENTE", "AMBOS"] } },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
    }),
    getAllCurrentPrices(),
    getAllPedidosPendientes(),
  ]);

  const pricesByEntity: Record<
    string,
    Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>>
  > = {};
  for (const price of allPrices.values()) {
    const byCircuit = (pricesByEntity[price.entityId] ??= { BLANCO: {}, NEGRO: {} });
    byCircuit[price.circuit][price.productId] = { amount: price.amount.toNumber(), currency: price.currency };
  }

  const pedidosByEntity: Record<
    string,
    { id: string; orderNumber: string; status: string; lines: { productId: string; pallets: number; label: string }[] }[]
  > = {};
  for (const pedido of allPedidos) {
    (pedidosByEntity[pedido.entityId] ??= []).push({
      id: pedido.id,
      orderNumber: pedido.orderNumber,
      status: pedido.status,
      lines: pedido.lines.map((l) => ({
        productId: l.productId,
        pallets: l.pallets.toNumber(),
        label: formatProductBrandLabel(l.product),
      })),
    });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/entregas" className="text-sm underline underline-offset-2">
          ← Volver a entregas
        </Link>
        <h1 className="text-xl font-semibold mt-2">Nueva entrega</h1>
      </div>

      {!canEdit && <p className="text-sm text-foreground/60">No tenés permisos para cargar entregas.</p>}

      {canEdit && (
        <NuevaEntregaForm
          action={submitRemito}
          clientes={clientes.map((c) => ({ id: c.id, name: c.name }))}
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            oilType: p.oilType,
            presentation: p.presentation,
            boxesPerPallet: p.boxesPerPallet,
            unitsPerBox: p.unitsPerBox,
          }))}
          pricesByEntity={pricesByEntity}
          pedidosByEntity={pedidosByEntity}
        />
      )}
    </div>
  );
}
