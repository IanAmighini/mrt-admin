import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getProductStock } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import { deleteRecipeLine, upsertRecipeLine } from "./actions";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { recipe: { include: { item: true } } },
  });
  if (!product) notFound();

  const [stock, items] = await Promise.all([
    getProductStock(product.id),
    prisma.item.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/produccion" className="text-sm underline underline-offset-2">
          ← Producción
        </Link>
        <div className="mt-2 flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-semibold">{product.name}</h1>
            <p className="text-sm text-black/60">
              {product.oilType} — {product.presentation}
            </p>
          </div>
          <p className="text-lg font-semibold">{formatQuantity(stock)}</p>
        </div>
      </div>

      {canEdit && (
        <form
          action={upsertRecipeLine}
          className="grid max-w-xl gap-3 rounded-lg border border-black/10 p-4"
        >
          <h2 className="text-sm font-semibold">Agregar / actualizar insumo de la receta</h2>
          <input type="hidden" name="productId" value={product.id} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="itemId">
                Insumo
              </label>
              <select
                id="itemId"
                name="itemId"
                required
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.unit})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="quantityPerUnit">
                Cantidad por unidad de producto
              </label>
              <input
                id="quantityPerUnit"
                name="quantityPerUnit"
                required
                inputMode="decimal"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-fit rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80"
          >
            Guardar
          </button>
        </form>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2">Receta (BOM)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Insumo</th>
                <th className="py-2 pr-4">Cantidad por unidad</th>
                {canEdit && <th className="py-2 pr-4"></th>}
              </tr>
            </thead>
            <tbody>
              {product.recipe.map((line) => (
                <tr key={line.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">{line.item.name}</td>
                  <td className="py-2 pr-4">
                    {formatQuantity(line.quantityPerUnit, line.item.unit)}
                  </td>
                  {canEdit && (
                    <td className="py-2 pr-4">
                      <form action={deleteRecipeLine}>
                        <input type="hidden" name="recipeItemId" value={line.id} />
                        <input type="hidden" name="productId" value={product.id} />
                        <button type="submit" className="text-xs underline underline-offset-2">
                          Quitar
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {product.recipe.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 3 : 2} className="py-4 text-center text-black/40">
                    Este producto todavía no tiene receta cargada.
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
