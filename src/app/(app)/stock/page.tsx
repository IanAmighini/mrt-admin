import Link from "next/link";
import type { SupplierCategory } from "@prisma/client";
import { Archive, Droplet, HelpCircle, Layers, PackageOpen, Scissors, Tag, type LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllItemStocks, getAllProductStocks } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import { SUPPLIER_CATEGORY_LABELS, SUPPLIER_CATEGORY_ORDER } from "@/lib/labels";
import { formatPallets } from "@/lib/product-label";
import { compareItemsBySize } from "@/lib/item-order";
import { FormModal } from "@/components/Modal";
import { ItemMovementFields } from "@/components/ItemMovementFields";
import { FilterBar, FiltroBuscar, FiltroSelect } from "@/components/ui/FilterBar";
import { Table, TableEmpty, Td, Th, Thead, Tr } from "@/components/ui/Table";
import { createItem } from "./actions";
import { createItemMovement } from "./[itemId]/actions";

const CATEGORY_ICONS: Record<SupplierCategory, LucideIcon> = {
  ACEITE: Droplet,
  PREFORMAS: PackageOpen,
  ENVASES: PackageOpen,
  TAPAS: PackageOpen,
  CAJAS: Archive,
  ETIQUETAS: Tag,
  ADITIVO_TINTA: Droplet,
  JABON: Droplet,
  CINTA: Scissors,
  PEGAMENTO: Droplet,
  STRETCH: Scissors,
  PALLET_NORMALIZADO: Layers,
  PALLET_DESCARTABLE: Layers,
  OTRO: HelpCircle,
};

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ver?: string; bajo?: string }>;
}) {
  const { q, ver, bajo } = await searchParams;
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
  // "Ver" acota a una sección: con 47 insumos repartidos en siete categorías, llegar a las
  // etiquetas era bajar media pantalla. Vacío = todo, como antes.
  const soloBajoMinimo = bajo === "1";
  const verProducto = !ver || ver === "producto";
  const verCategoria = ver && ver !== "producto" ? (ver as SupplierCategory) : null;
  const hayFiltro = Boolean(searchTerm || ver || soloBajoMinimo);
  const stockRows = (verProducto ? products : [])
    .map((product) => ({ product, stock: productStocks.get(product.id) ?? 0 }))
    .filter(({ stock }) => Number(stock) !== 0)
    .filter(
      ({ product }) =>
        !searchTerm ||
        product.name.toLowerCase().includes(searchTerm) ||
        product.oilType.toLowerCase().includes(searchTerm) ||
        product.presentation.toLowerCase().includes(searchTerm)
    );

  // Los insumos que no llevan stock no tienen nada que mostrar acá: su número no significa nada
  // porque nada los consume. El gasto queda igual en la cuenta corriente del proveedor.
  // Las categorías que de verdad tienen insumos, para no ofrecer un filtro que no devuelve nada.
  const itemsPorCategoriaTotal = new Set(items.filter((i) => i.llevaStock).map((i) => i.category));

  const itemsByCategory = new Map<SupplierCategory, typeof items>();
  const insumosVisibles = items
    .filter((i) => i.llevaStock)
    .filter((i) => !verCategoria || i.category === verCategoria)
    .filter(() => !ver || ver !== "producto")
    // El buscador filtraba sólo el producto terminado: escribir "etiqueta" dejaba la lista de
    // insumos entera igual, que es justo donde uno busca.
    .filter(
      (i) =>
        !searchTerm ||
        i.name.toLowerCase().includes(searchTerm) ||
        SUPPLIER_CATEGORY_LABELS[i.category].toLowerCase().includes(searchTerm)
    )
    .filter((i) => {
      if (!soloBajoMinimo) return true;
      const stock = stocks.get(i.id);
      return i.minStock != null && stock != null && Number(stock) <= Number(i.minStock);
    });
  for (const item of insumosVisibles) {
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

      <FilterBar limpiarHref="/stock" hayFiltro={hayFiltro} textoBoton="Filtrar">
        <FiltroBuscar defaultValue={q} placeholder="Marca, aceite, formato o insumo…" />
        <FiltroSelect
          label="Ver"
          name="ver"
          defaultValue={ver}
          todos="Todo"
          className="w-full sm:w-52"
          opciones={[
            { value: "producto", label: "Sólo producto terminado" },
            ...SUPPLIER_CATEGORY_ORDER.filter((c) => itemsPorCategoriaTotal.has(c)).map((c) => ({
              value: c,
              label: SUPPLIER_CATEGORY_LABELS[c],
            })),
          ]}
        />
        <FiltroSelect
          label="Mínimo"
          name="bajo"
          defaultValue={soloBajoMinimo ? "1" : ""}
          todos="Todos"
          opciones={[{ value: "1", label: "Bajo el mínimo" }]}
        />
      </FilterBar>

      {verProducto && (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Producto terminado</h2>
        <Table suelta={false}>
          <Thead>
            <Th className="pl-4">Marca</Th>
            <Th secundaria>Tipo de aceite</Th>
            <Th>Formato</Th>
            <Th align="derecha" className="pr-4">
              Stock
            </Th>
          </Thead>
            <tbody>
              {stockRows.map(({ product, stock }) => {
                const negative = Number(stock) < 0;
                return (
                  <Tr key={product.id}>
                    <Td className="pl-4">
                      {product.name}
                      <span className="block text-xs text-foreground/50 md:hidden">
                        {product.oilType}
                      </span>
                    </Td>
                    <Td secundaria>{product.oilType}</Td>
                    <Td>
                      <Link href={`/produccion/${product.slug}`} className="underline underline-offset-2">
                        {product.presentation}
                      </Link>
                    </Td>
                    <Td
                      numero
                      className={`pr-4 font-medium ${negative ? "text-red-600 dark:text-red-400" : ""}`}
                    >
                      {formatPallets(stock, product.boxesPerPallet)}
                    </Td>
                  </Tr>
                );
              })}
              {stockRows.length === 0 && (
                <TableEmpty colSpan={4}>
                  {hayFiltro
                    ? "No hay producto terminado con este filtro."
                    : "No hay stock de producto terminado ahora mismo."}
                </TableEmpty>
              )}
            </tbody>
        </Table>
      </section>
      )}

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
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="llevaStock" defaultChecked />
                <span>
                  Lleva stock
                  <span className="block text-xs text-foreground/50">
                    Destildalo para los consumibles que se compran y no se cuentan, como el
                    pegamento: el gasto va a la cuenta corriente pero no genera movimiento ni
                    aparece en esta pantalla.
                  </span>
                </span>
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
