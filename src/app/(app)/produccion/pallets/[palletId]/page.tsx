import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatQuantity } from "@/lib/money";
import { formatProductLabel } from "@/lib/product-label";
import { PALLET_STATUS_LABELS } from "@/lib/labels";
import { dismantlePallet } from "./actions";

export default async function PalletDetailPage({
  params,
}: {
  params: Promise<{ palletId: string }>;
}) {
  const { palletId } = await params;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const pallet = await prisma.pallet.findUnique({
    where: { id: palletId },
    include: {
      woodItem: true,
      filmItem: true,
      createdBy: true,
      boxes: { include: { boxType: { include: { product: true } } } },
    },
  });
  if (!pallet) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link href="/produccion" className="text-sm underline underline-offset-2">
          ← Producción
        </Link>
        <div className="mt-2 flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-semibold">{pallet.label || `Pallet ${pallet.id.slice(0, 8)}`}</h1>
            <p className="text-sm text-foreground/60">
              {pallet.date.toLocaleDateString("es-AR")} — cargado por {pallet.createdBy.name}
            </p>
          </div>
          <p className="text-lg font-semibold">{PALLET_STATUS_LABELS[pallet.status]}</p>
        </div>
      </div>

      {canEdit && pallet.status === "ARMADO" && (
        <form action={dismantlePallet}>
          <input type="hidden" name="palletId" value={pallet.id} />
          <button
            type="submit"
            className="w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Desarmar pallet
          </button>
        </form>
      )}

      {pallet.status === "DESARMADO" && pallet.dismantledAt && (
        <p className="text-sm text-foreground/60">
          Desarmado el {pallet.dismantledAt.toLocaleDateString("es-AR")}. Las cajas volvieron a
          stock; el pallet de madera y el film consumidos no se recuperan.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-foreground/10 p-4">
          <p className="text-sm font-semibold mb-1">Pallet de madera</p>
          <p className="text-sm text-foreground/60">{pallet.woodItem.name} — 1 unidad consumida</p>
        </div>
        <div className="rounded-lg border border-foreground/10 p-4">
          <p className="text-sm font-semibold mb-1">Film</p>
          <p className="text-sm text-foreground/60">
            {pallet.filmItem.name} — {formatQuantity(pallet.filmQuantity)} consumido
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">Cajas incluidas</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Tipo de caja</th>
                <th className="py-2 pr-4">Producto</th>
                <th className="py-2 pr-4">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {pallet.boxes.map((box) => (
                <tr key={box.id} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">{box.boxType.label}</td>
                  <td className="py-2 pr-4">{formatProductLabel(box.boxType.product)}</td>
                  <td className="py-2 pr-4">{formatQuantity(box.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
