import Link from "next/link";
import type { SupplierCategory } from "@prisma/client";
import { Archive, Droplet, HelpCircle, Layers, PackageOpen, Scissors, Tag, type LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllItemStocks, getAllProductStocks } from "@/lib/stock";
import { getLitrosEnvasados } from "@/lib/reports";
import { formatQuantity } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { FormModal } from "@/components/Modal";
import { ItemMovementFields } from "@/components/ItemMovementFields";
import { createItem } from "./actions";
import { createItemMovement } from "./[itemId]/actions";

const CATEGORY_ORDER: SupplierCategory[] = [
  "ACEITE",
  "ENVASES",
  "TAPAS",
  "CAJAS",
  "ETIQUETAS",
  "CINTA",
  "PALLET_NORMALIZADO",
  "OTRO",
];

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

/** Los nombres de insumo siguen la convención "Envase 850ml" / "Tapa 900ml" — se usa para
 * ordenar cada categoría de menor a mayor tamaño en vez de alfabéticamente. */
function extractMl(name: string): number | null {
  const match = name.match(/(\d+)\s*ml/i);
  return match ? parseInt(match[1], 10) : null;
}

export default async function StockPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [items, stocks, products, productStocks, litros] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    getAllItemStocks(),
    prisma.product.findMany({
      orderBy: [{ name: "asc" }, { oilType: "asc" }, { bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
    }),
    getAllProductStocks(),
    getLitrosEnvasados(),
  ]);

  const marcaGroups = new Map<string, { name: string; oilType: string; products: typeof products }>();
  for (const product of products) {
    const key = `${product.name}|${product.oilType}`;
    const group = marcaGroups.get(key) ?? { name: product.name, oilType: product.oilType, products: [] };
    group.products.push(product);
    marcaGroups.set(key, group);
  }

  const itemsByCategory = new Map<SupplierCategory, typeof items>();
  for (const item of items) {
    const list = itemsByCategory.get(item.category) ?? [];
    list.push(item);
    itemsByCategory.set(item.category, list);
  }
  for (const list of itemsByCategory.values()) {
    list.sort((a, b) => {
      const mlA = extractMl(a.name);
      const mlB = extractMl(b.name);
      if (mlA !== null && mlB !== null && mlA !== mlB) return mlA - mlB;
      if (mlA !== null && mlB === null) return -1;
      if (mlA === null && mlB !== null) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Stock</h1>
        <p className="text-sm text-foreground/60">Producto terminado e insumos disponibles ahora mismo.</p>
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from(marcaGroups.values()).map((marca) => (
            <div
              key={`${marca.name}|${marca.oilType}`}
              className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4"
            >
              <p className="mb-2 text-sm font-semibold">{formatProductBrandLabel(marca)}</p>
              <div className="space-y-1">
                {marca.products.map((product) => {
                  const stock = productStocks.get(product.id) ?? 0;
                  const negative = Number(stock) < 0;
                  return (
                    <div key={product.id} className="flex items-center justify-between text-sm">
                      <Link
                        href={`/produccion/${product.id}`}
                        className="text-foreground/60 underline underline-offset-2"
                      >
                        {product.presentation}
                      </Link>
                      <span className={negative ? "font-medium text-red-600 dark:text-red-400" : "font-medium"}>
                        {formatQuantity(stock, "pallets")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {marcaGroups.size === 0 && (
            <p className="text-sm text-foreground/40">Todavía no hay productos cargados.</p>
          )}
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-lg font-semibold">Insumos</h2>

        {canEdit && (
          <form action={createItem} className="grid max-w-xl gap-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
            <h3 className="text-sm font-semibold">Nuevo insumo</h3>
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
                  {CATEGORY_ORDER.map((c) => (
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
          </form>
        )}

        <div className="space-y-4">
          {CATEGORY_ORDER.map((category) => {
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
                      return (
                        <div key={item.id} className="flex items-center justify-between text-sm">
                          <Link href={`/stock/${item.id}`} className="underline underline-offset-2">
                            {item.name}
                          </Link>
                          <span className={negative ? "font-medium text-red-600 dark:text-red-400" : "font-medium"}>
                            {formatQuantity(stock, item.unit)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {categoryItems.length === 1 && (
                  <Link
                    href={`/stock/${categoryItems[0].id}`}
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
