import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllProductStocks } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import { createProduct, createProductionRun } from "./actions";
import { ProductionLinesFields } from "./ProductionLinesFields";

export default async function ProduccionPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [products, stocks, runs] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: "asc" },
      include: { recipe: true },
    }),
    getAllProductStocks(),
    prisma.productionRun.findMany({
      orderBy: { date: "desc" },
      include: { lines: { include: { product: true } }, createdBy: true },
      take: 30,
    }),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Producción</h1>
        <p className="text-sm text-black/60">
          Productos, receta (BOM) y carga de producción diaria.
        </p>
      </div>

      {canEdit && (
        <form
          action={createProduct}
          className="grid max-w-xl gap-3 rounded-lg border border-black/10 p-4"
        >
          <h2 className="text-sm font-semibold">Nuevo producto</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <label className="text-sm" htmlFor="name">
                Nombre
              </label>
              <input
                id="name"
                name="name"
                required
                placeholder="Aceite Tipo A — Botella 1L"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="oilType">
                Tipo de aceite
              </label>
              <input
                id="oilType"
                name="oilType"
                required
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="presentation">
                Presentación
              </label>
              <input
                id="presentation"
                name="presentation"
                required
                placeholder="Botella 1L"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-fit rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80"
          >
            Crear
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-black/60">
              <th className="py-2 pr-4">Producto</th>
              <th className="py-2 pr-4">Tipo de aceite</th>
              <th className="py-2 pr-4">Presentación</th>
              <th className="py-2 pr-4">Insumos en receta</th>
              <th className="py-2 pr-4">Stock actual</th>
            </tr>
          </thead>
          <tbody>
            {products
              .filter((product) => {
                const stock = stocks.get(product.id);
                return stock !== undefined && !stock.isZero();
              })
              .map((product) => (
                <tr key={product.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">
                    <Link href={`/produccion/${product.id}`} className="underline underline-offset-2">
                      {product.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{product.oilType}</td>
                  <td className="py-2 pr-4">{product.presentation}</td>
                  <td className="py-2 pr-4">
                    {product.recipe.length === 0 ? (
                      <span className="text-black/40">Sin receta</span>
                    ) : (
                      product.recipe.length
                    )}
                  </td>
                  <td className="py-2 pr-4">{formatQuantity(stocks.get(product.id) ?? 0)}</td>
                </tr>
              ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-black/40">
                  Todavía no hay productos cargados.
                </td>
              </tr>
            )}
            {products.length > 0 &&
              products.every((product) => {
                const stock = stocks.get(product.id);
                return stock === undefined || stock.isZero();
              }) && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-black/40">
                    No hay stock cargado — todos los productos están en 0.
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form
          action={createProductionRun}
          className="space-y-3 rounded-lg border border-black/10 p-4"
        >
          <h2 className="text-sm font-semibold">Parte de producción diaria</h2>
          <div className="space-y-1 max-w-xs">
            <label className="text-sm" htmlFor="date">
              Fecha
            </label>
            <input
              id="date"
              type="date"
              name="date"
              required
              className="w-full rounded border border-black/20 px-3 py-2 text-sm"
            />
          </div>
          <ProductionLinesFields products={products.map((p) => ({ id: p.id, name: p.name }))} />
          <button
            type="submit"
            className="w-fit rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80"
          >
            Registrar parte
          </button>
        </form>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2">Historial de partes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Producción</th>
                <th className="py-2 pr-4">Cargado por</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">{run.date.toLocaleDateString("es-AR")}</td>
                  <td className="py-2 pr-4">
                    {run.lines
                      .map((line) => `${line.product.name}: ${formatQuantity(line.quantity)}`)
                      .join(" · ")}
                  </td>
                  <td className="py-2 pr-4">{run.createdBy.name}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-black/40">
                    Sin partes de producción todavía.
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
