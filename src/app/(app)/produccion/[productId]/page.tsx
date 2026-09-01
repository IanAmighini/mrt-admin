import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getProductStock } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import {
  deleteRecipeLine,
  generateRecipeFromPresentation,
  updateProduct,
  upsertRecipeLine,
} from "./actions";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA" || user.role === "SECRETARIA";

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
            <p className="text-sm text-foreground/60">
              {product.oilType} — {product.presentation}
              {product.boxesPerPallet && product.unitsPerBox && (
                <>
                  {" "}
                  ({product.boxesPerPallet} cajas × {product.unitsPerBox} unidades ={" "}
                  {product.boxesPerPallet * product.unitsPerBox} unidades por pallet)
                </>
              )}
            </p>
          </div>
          <p className="text-lg font-semibold">{formatQuantity(stock)}</p>
        </div>
      </div>

      {canEdit && (
        <form
          action={updateProduct}
          className="grid max-w-xl gap-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4"
        >
          <h2 className="text-sm font-semibold">Editar producto</h2>
          <input type="hidden" name="productId" value={product.id} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <label className="text-sm" htmlFor="edit-name">
                Marca
              </label>
              <input
                id="edit-name"
                name="name"
                required
                defaultValue={product.name}
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="edit-oilType">
                Tipo de aceite
              </label>
              <input
                id="edit-oilType"
                name="oilType"
                required
                defaultValue={product.oilType}
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="edit-presentation">
                Presentación
              </label>
              <input
                id="edit-presentation"
                name="presentation"
                required
                defaultValue={product.presentation}
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="edit-boxesPerPallet">
                Cajas por pallet
              </label>
              <input
                id="edit-boxesPerPallet"
                name="boxesPerPallet"
                inputMode="numeric"
                defaultValue={product.boxesPerPallet ?? ""}
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="edit-unitsPerBox">
                Botellas por caja
              </label>
              <input
                id="edit-unitsPerBox"
                name="unitsPerBox"
                inputMode="numeric"
                defaultValue={product.unitsPerBox ?? ""}
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="edit-bottleCapacityMl">
                Capacidad de botella (ml)
              </label>
              <input
                id="edit-bottleCapacityMl"
                name="bottleCapacityMl"
                inputMode="decimal"
                defaultValue={product.bottleCapacityMl?.toString() ?? ""}
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            Guardar cambios
          </button>
        </form>
      )}

      {canEdit && product.boxesPerPallet && product.unitsPerBox && (
        <form
          action={generateRecipeFromPresentation}
          className="grid max-w-xl gap-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4"
        >
          <h2 className="text-sm font-semibold">Generar receta desde presentación</h2>
          <p className="text-xs text-foreground/50">
            Calcula automáticamente la cantidad de cada insumo por pallet armado a partir de
            cajas/botellas/capacidad y la eficiencia de llenado. Dejá en blanco los insumos que
            no apliquen.
          </p>
          <input type="hidden" name="productId" value={product.id} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pallet de madera">
              <select name="woodPalletItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Botella / bidón">
              <select name="bottleItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tapa">
              <select name="capItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Etiqueta">
              <select name="labelItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Caja">
              <select name="boxItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Aceite">
              <select name="oilItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <button
            type="submit"
            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            Generar receta
          </button>
        </form>
      )}

      {canEdit && (
        <form
          action={upsertRecipeLine}
          className="grid max-w-xl gap-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4"
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
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
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
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-foreground/50">
            &quot;Unidad de producto&quot; acá es 1 pallet armado (así se carga la producción
            diaria de este producto).
          </p>
          <button
            type="submit"
            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
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
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Insumo</th>
                <th className="py-2 pr-4">Cantidad por unidad</th>
                {canEdit && <th className="py-2 pr-4"></th>}
              </tr>
            </thead>
            <tbody>
              {product.recipe.map((line) => (
                <tr key={line.id} className="border-b border-foreground/5">
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
                  <td colSpan={canEdit ? 3 : 2} className="py-4 text-center text-foreground/40">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm">{label}</label>
      {children}
    </div>
  );
}

const selectClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
