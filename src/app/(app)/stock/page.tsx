import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllItemStocks, getAllProductStockLevels } from "@/lib/stock";
import { getLitrosEnvasados } from "@/lib/reports";
import { formatMoney, formatQuantity } from "@/lib/money";
import { formatProductLabel } from "@/lib/product-label";
import { createItem } from "./actions";

export default async function StockPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [items, stocks, products, productLevels, litros] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    getAllItemStocks(),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    getAllProductStockLevels(),
    getLitrosEnvasados(),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Stock</h1>
        <p className="text-sm text-foreground/60">
          Producto terminado e insumos — el stock se calcula a partir del historial de movimientos
          (kardex) de cada uno.
        </p>
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4 max-w-xs">
        <p className="text-sm font-semibold mb-1">Litros envasados</p>
        <p className="text-2xl font-semibold">{formatQuantity(litros.esteMes, "L")}</p>
        <p className="text-xs text-foreground/50 mt-1">
          este mes — {formatQuantity(litros.total, "L")} total histórico
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Producto terminado</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Producto</th>
                <th className="py-2 pr-4">Suelto</th>
                <th className="py-2 pr-4">En cajas</th>
                <th className="py-2 pr-4">En pallets armados</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const levels = productLevels.get(product.id);
                return (
                  <tr key={product.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/produccion/${product.id}`}
                        className="underline underline-offset-2"
                      >
                        {formatProductLabel(product)}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{formatQuantity(levels?.suelto ?? 0)}</td>
                    <td className="py-2 pr-4">{formatQuantity(levels?.enCajas ?? 0)}</td>
                    <td className="py-2 pr-4">{formatQuantity(levels?.enPallets ?? 0)}</td>
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-foreground/40">
                    Todavía no hay productos cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-lg font-semibold">Insumos</h2>

        {canEdit && (
        <form action={createItem} className="grid max-w-xl gap-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <h2 className="text-sm font-semibold">Nuevo insumo</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="name">
                Nombre
              </label>
              <input
                id="name"
                name="name"
                required
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="unit">
                Unidad de medida
              </label>
              <input
                id="unit"
                name="unit"
                required
                placeholder="L, unidad, kg..."
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="minStock">
                Stock mínimo (opcional)
              </label>
              <input
                id="minStock"
                name="minStock"
                inputMode="decimal"
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="unitCost">
                Costo unitario (opcional)
              </label>
              <input
                id="unitCost"
                name="unitCost"
                inputMode="decimal"
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="stockInicial">
                Stock inicial (opcional)
              </label>
              <input
                id="stockInicial"
                name="stockInicial"
                inputMode="decimal"
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isResellable" />
            Es revendible
          </label>
          <button
            type="submit"
            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
          >
            Crear
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Insumo</th>
              <th className="py-2 pr-4">Unidad</th>
              <th className="py-2 pr-4">Stock actual</th>
              <th className="py-2 pr-4">Costo unitario</th>
              <th className="py-2 pr-4">Revendible</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4">
                  <Link href={`/stock/${item.id}`} className="underline underline-offset-2">
                    {item.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{item.unit}</td>
                <td className="py-2 pr-4">
                  {formatQuantity(stocks.get(item.id) ?? 0, item.unit)}
                </td>
                <td className="py-2 pr-4">{item.unitCost ? formatMoney(item.unitCost) : "—"}</td>
                <td className="py-2 pr-4">{item.isResellable ? "Sí" : "No"}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-foreground/40">
                  Todavía no hay insumos cargados.
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

