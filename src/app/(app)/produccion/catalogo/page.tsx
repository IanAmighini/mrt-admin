import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllProductStocks } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import { formatProductLabel } from "@/lib/product-label";

export default async function CatalogoPage() {
  await requireUser();

  const [marcas, formatos, products, stocks] = await Promise.all([
    prisma.marca.findMany({ orderBy: [{ name: "asc" }, { oilType: "asc" }] }),
    prisma.formato.findMany({ orderBy: { presentation: "asc" } }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      include: { recipe: true },
    }),
    getAllProductStocks(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/produccion" className="text-sm underline underline-offset-2">
          ← Producción
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Catálogo</h1>
        <p className="text-sm text-foreground/60">
          Marcas, formatos de pallet y productos registrados en el sistema.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Marcas</h2>
        <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 px-4">Marca</th>
                <th className="py-2 px-4">Tipo de aceite</th>
                <th className="py-2 px-4">Productos</th>
              </tr>
            </thead>
            <tbody>
              {marcas.map((marca) => {
                const count = products.filter(
                  (p) => p.name === marca.name && p.oilType === marca.oilType
                ).length;
                return (
                  <tr key={marca.id} className="border-b border-foreground/5 last:border-0">
                    <td className="py-2 px-4">{marca.name}</td>
                    <td className="py-2 px-4">{marca.oilType}</td>
                    <td className="py-2 px-4">
                      {count === 0 ? (
                        <span className="text-foreground/40">Sin productos</span>
                      ) : (
                        count
                      )}
                    </td>
                  </tr>
                );
              })}
              {marcas.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-foreground/40">
                    Todavía no hay marcas cargadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Formatos de pallet</h2>
        <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 px-4">Presentación</th>
                <th className="py-2 px-4">Cajas por pallet</th>
                <th className="py-2 px-4">Botellas por caja</th>
                <th className="py-2 px-4">Capacidad (ml)</th>
                <th className="py-2 px-4">Productos</th>
              </tr>
            </thead>
            <tbody>
              {formatos.map((formato) => {
                const count = products.filter((p) => p.presentation === formato.presentation).length;
                return (
                  <tr key={formato.id} className="border-b border-foreground/5 last:border-0">
                    <td className="py-2 px-4">{formato.presentation}</td>
                    <td className="py-2 px-4">{formato.boxesPerPallet}</td>
                    <td className="py-2 px-4">{formato.unitsPerBox}</td>
                    <td className="py-2 px-4">{formatQuantity(formato.bottleCapacityMl)}</td>
                    <td className="py-2 px-4">
                      {count === 0 ? (
                        <span className="text-foreground/40">Sin productos</span>
                      ) : (
                        count
                      )}
                    </td>
                  </tr>
                );
              })}
              {formatos.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-foreground/40">
                    Todavía no hay formatos cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Productos</h2>
        <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 px-4">Producto</th>
                <th className="py-2 px-4">Tipo de aceite</th>
                <th className="py-2 px-4">Presentación</th>
                <th className="py-2 px-4">Insumos en receta</th>
                <th className="py-2 px-4">Stock actual</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-foreground/5 last:border-0">
                  <td className="py-2 px-4">
                    <Link href={`/produccion/${product.id}`} className="underline underline-offset-2">
                      {formatProductLabel(product)}
                    </Link>
                  </td>
                  <td className="py-2 px-4">{product.oilType}</td>
                  <td className="py-2 px-4">{product.presentation}</td>
                  <td className="py-2 px-4">
                    {product.recipe.length === 0 ? (
                      <span className="text-foreground/40">Sin receta</span>
                    ) : (
                      product.recipe.length
                    )}
                  </td>
                  <td className="py-2 px-4">
                    {formatQuantity(stocks.get(product.id) ?? 0, "pallets")}
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-foreground/40">
                    Todavía no hay productos cargados.
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
