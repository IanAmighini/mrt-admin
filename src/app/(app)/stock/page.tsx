import Link from "next/link";
import { Search } from "lucide-react";
import type { SupplierCategory } from "@prisma/client";
import { Archive, Droplet, HelpCircle, Layers, PackageOpen, Scissors, Tag, type LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllItemStocks, getAllProductStocks } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import { SUPPLIER_CATEGORY_LABELS, SUPPLIER_CATEGORY_ORDER } from "@/lib/labels";
import { compareItemsBySize } from "@/lib/item-order";
import { FormModal } from "@/components/Modal";
import { ItemMovementFields } from "@/components/ItemMovementFields";
import { createItem } from "./actions";
import { createItemMovement } from "./[itemId]/actions";

const CATEGORY_ICONS: Record<SupplierCategory, LucideIcon> = {
  ACEITE: Droplet,
  ENVASES: PackageOpen,
  TAPAS: PackageOpen,
  CAJAS: Archive,
  ETIQUETAS: Tag,
  CINTA: Scissors,
  PALLET_NORMALIZADO: Layers,
  OTRO: HelpCircle,
};

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [items, stocks, products, productStocks] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    getAllItemStocks(),
    prisma.product.findMany({
      orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
    }),
    getAllProductStocks(),
  ]);

  const searchTerm = q?.trim().toLowerCase();
  const stockRows = products
    .map((product) => ({ product, stock: productStocks.get(product.id) ?? 0 }))
    .filter(({ stock }) => Number(stock) !== 0)
    .filter(
      ({ product }) =>
        !searchTerm ||
        product.name.toLowerCase().includes(searchTerm) ||
        product.oilType.toLowerCase().includes(searchTerm) ||
        product.presentation.toLowerCase().includes(searchTerm)
    );

  const itemsByCategory = new Map<SupplierCategory, typeof items>();
  for (const item of items) {
    const list = itemsByCategory.get(item.category) ?? [];
    list.push(item);
    itemsByCategory.set(item.category, list);
  }
  for (const list of itemsByCategory.values()) {
    list.sort(compareItemsBySize);
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Stock</h1>
        <p className="text-sm text-foreground/60">Producto terminado e insumos disponibles ahora mismo.</p>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Producto terminado</h2>
          <form className="flex min-w-[240px] gap-2">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="Buscar por marca, aceite o formato…"
                className="w-full rounded-lg border border-foreground/20 bg-background py-2 pl-9 pr-3 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm hover:bg-foreground/5"
            >
              Buscar
            </button>
          </form>
        </div>
        <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 px-4">Marca</th>
                <th className="py-2 px-4">Tipo de aceite</th>
                <th className="py-2 px-4">Formato</th>
                <th className="py-2 px-4">Stock (pallets)</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map(({ product, stock }) => {
                const negative = Number(stock) < 0;
                return (
                  <tr key={product.id} className="border-b border-foreground/5 last:border-0">
                    <td className="py-2 px-4">{product.name}</td>
                    <td className="py-2 px-4">{product.oilType}</td>
                    <td className="py-2 px-4">
                      <Link href={`/produccion/${product.slug}`} className="underline underline-offset-2">
                        {product.presentation}
                      </Link>
                    </td>
                    <td className={`py-2 px-4 font-medium ${negative ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatQuantity(stock, "pallets")}
                    </td>
                  </tr>
                );
              })}
              {stockRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-foreground/40">
                    {searchTerm ? "No hay resultados con este filtro." : "No hay stock de producto terminado ahora mismo."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Insumos</h2>
          {canEdit && (
            <FormModal triggerLabel="Nuevo insumo" title="Nuevo insumo" action={createItem}>
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
                  <label className="text-sm" htmlFor="category">
                    Categoría
                  </label>
                  <select
                    id="category"
                    name="category"
                    required
                    className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
                  >
                    {SUPPLIER_CATEGORY_ORDER.map((c) => (
                      <option key={c} value={c}>
                        {SUPPLIER_CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
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
            </FormModal>
          )}
        </div>

        <div className="space-y-4">
          {SUPPLIER_CATEGORY_ORDER.map((category) => {
            const categoryItems = itemsByCategory.get(category);
            if (!categoryItems || categoryItems.length === 0) return null;

            const Icon = CATEGORY_ICONS[category];
            const disponible = categoryItems.reduce((acc, item) => acc + Number(stocks.get(item.id) ?? 0), 0);
            const unit = categoryItems[0].unit;
            const categoryLabel = SUPPLIER_CATEGORY_LABELS[category];

            return (
              <div key={category} className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon size={18} className="text-foreground/60" />
                    <h3 className="text-base font-semibold">Stock de {categoryLabel.toLowerCase()}</h3>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      <FormModal
                        triggerLabel="Registrar merma"
                        title={`Registrar merma — ${categoryLabel}`}
                        action={createItemMovement}
                        iconName="edit"
                      >
                        <ItemMovementFields items={categoryItems} type="MERMA" />
                      </FormModal>
                      <FormModal
                        triggerLabel={`Ingreso de ${categoryLabel.toLowerCase()}`}
                        title={`Ingreso de ${categoryLabel.toLowerCase()}`}
                        action={createItemMovement}
                      >
                        <ItemMovementFields items={categoryItems} type="INGRESO" showConversion={category === "ACEITE"} />
                      </FormModal>
                    </div>
                  )}
                </div>

                <div className="rounded-lg bg-foreground/[0.03] p-3">
                  <p className="text-xs text-foreground/50">Disponible</p>
                  <p className="text-xl font-semibold">{formatQuantity(disponible, unit)}</p>
                </div>

                {categoryItems.length > 1 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
                      Detalle
                    </p>
                    {categoryItems.map((item) => {
                      const stock = stocks.get(item.id) ?? 0;
                      const negative = Number(stock) < 0;
                      // Ámbar cuando está en o por debajo del mínimo; el rojo queda para stock negativo.
                      const minStock = item.minStock;
                      const bajoMinimo =
                        !negative && minStock != null && Number(stock) <= Number(minStock);
                      return (
                        <div key={item.id} className="flex items-center justify-between text-sm">
                          <Link href={`/stock/${item.slug}`} className="underline underline-offset-2">
                            {item.name}
                          </Link>
                          <span
                            title={
                              bajoMinimo && minStock
                                ? `Por debajo del mínimo (${formatQuantity(minStock, item.unit)})`
                                : undefined
                            }
                            className={
                              negative
                                ? "font-medium text-red-600 dark:text-red-400"
                                : bajoMinimo
                                  ? "font-medium text-amber-600 dark:text-amber-400"
                                  : "font-medium"
                            }
                          >
                            {formatQuantity(stock, item.unit)}
                            {bajoMinimo && " ▾"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {categoryItems.length === 1 && (
                  <Link
                    href={`/stock/${categoryItems[0].slug}`}
                    className="text-xs underline underline-offset-2"
                  >
                    Ver kardex
                  </Link>
                )}
              </div>
            );
          })}
          {items.length === 0 && <p className="text-sm text-foreground/40">Todavía no hay insumos cargados.</p>}
        </div>
      </section>
    </div>
  );
}
