import Link from "next/link";
import type { Item, Prisma, SupplierCategory } from "@prisma/client";
import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { formatQuantity } from "@/lib/money";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { compareItemsBySize } from "@/lib/item-order";

type Stocks = Map<string, Prisma.Decimal | number>;

/** "unidad" → "unidades", "rollo" → "rollos"; las abreviaturas (L, kg) quedan como están. */
export function unidadEnPlural(unidad: string, cantidad: number) {
  if (Math.abs(cantidad) === 1 || !/^[a-záéíóúñ]{3,}$/i.test(unidad)) return unidad;
  return /[aeiouáéíóú]$/i.test(unidad) ? `${unidad}s` : `${unidad}es`;
}

/** Los totales de una categoría, uno por unidad: sumar litros con kilos no da nada. */
function totalesPorUnidad(items: Item[], stocks: Stocks) {
  const porUnidad = new Map<string, number>();
  for (const item of items) porUnidad.set(item.unit, (porUnidad.get(item.unit) ?? 0) + Number(stocks.get(item.id) ?? 0));
  return Array.from(porUnidad.entries());
}

function formatTotales(totales: [string, number][]) {
  return totales.map(([unidad, n]) => `${formatQuantity(n)} ${unidadEnPlural(unidad, n)}`).join(" + ");
}

function estadoDe(item: Item, stocks: Stocks) {
  const stock = Number(stocks.get(item.id) ?? 0);
  const negativo = stock < 0;
  // Ámbar cuando está en o por debajo del mínimo; el rojo queda para el stock negativo.
  const bajoMinimo = !negativo && item.minStock != null && stock <= Number(item.minStock);
  return { stock, negativo, bajoMinimo };
}

/**
 * La tarjeta de un tipo de insumo en la vista general: el total al lado del nombre, y nada más.
 * Antes cada tipo listaba todos sus insumos de una, y con veintiséis etiquetas el número quedaba en
 * la otra punta de la pantalla, lejos del nombre. Tocarla lleva al detalle; si el tipo tiene un
 * solo insumo (el stretch, la cinta), lleva directo a su ficha.
 */
export function TarjetaDeCategoria({
  category,
  items,
  stocks,
  icon: Icon,
}: {
  category: SupplierCategory;
  items: Item[];
  stocks: Stocks;
  icon: LucideIcon;
}) {
  const estados = items.map((i) => estadoDe(i, stocks));
  const conStock = estados.filter((e) => e.stock > 0).length;
  const negativos = estados.filter((e) => e.negativo).length;
  const bajoMinimo = estados.filter((e) => e.bajoMinimo).length;
  const href = items.length === 1 ? `/stock/${items[0].slug}` : `/stock?ver=${category}`;
  const detalle =
    items.length === 1
      ? "Ver la ficha"
      : `${items.length} insumos${conStock < items.length ? ` · ${items.length - conStock} sin stock` : ""}`;

  return (
    <Link
      href={href}
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm transition-colors hover:border-primary hover:bg-foreground/[0.02]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-foreground/80">
        <Icon size={20} strokeWidth={2} />
      </span>
      {/* En el celular el total va abajo del nombre: al lado, el nombre quedaba en "Etiquet…". */}
      <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{SUPPLIER_CATEGORY_LABELS[category]}</p>
        <p className="truncate text-xs text-foreground/50">{detalle}</p>
        {(negativos > 0 || bajoMinimo > 0) && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {[
              negativos > 0 ? `${negativos} en negativo` : null,
              bajoMinimo > 0 ? `${bajoMinimo} bajo el mínimo` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
      <p className="shrink-0 text-lg font-semibold tabular-nums sm:text-right">{formatTotales(totalesPorUnidad(items, stocks))}</p>
      </div>
      <ChevronRight size={18} className="shrink-0 text-foreground/30 transition-colors group-hover:text-foreground/70" />
    </Link>
  );
}

/** El tamaño en ml de los insumos que lo llevan en el nombre: "Etiqueta … 900ml", "Caja … 12x900". */
function tamanoEnMl(nombre: string): number | null {
  const ml = nombre.match(/(\d+)\s*ml/i);
  if (ml) return parseInt(ml[1], 10);
  const porCaja = nombre.match(/\d+x(\d+)\s*$/);
  return porCaja ? parseInt(porCaja[1], 10) : null;
}

/** El nombre sin lo que ya dice el título: el tipo de insumo adelante y, dentro de un grupo, los ml. */
function nombreCorto(nombre: string, sinMl: boolean) {
  let corto = nombre.replace(/^(etiqueta|caja|envase|tapa|aceite|preforma)s?\s+/i, "");
  if (sinMl) corto = corto.replace(/\s*\d+\s*ml\b/i, "");
  return corto.trim() || nombre;
}

/**
 * El detalle de un tipo de insumo: un cuadrito por insumo con el número grande al lado del nombre.
 * Las etiquetas y las cajas, que son muchas, se agrupan por tamaño con su subtotal — que es como
 * se piensa en el depósito: "¿cuánto hay de 900?". Lo que no tiene stock va al final y apagado,
 * pero sigue estando para entrar a su ficha.
 */
export function DetalleDeCategoria({
  category,
  items,
  stocks,
  icon: Icon,
  acciones,
}: {
  category: SupplierCategory;
  items: Item[];
  stocks: Stocks;
  icon: LucideIcon;
  acciones?: React.ReactNode;
}) {
  const tamanos = items.map((i) => tamanoEnMl(i.name));
  const agrupar =
    items.length > 6 &&
    tamanos.every((t) => t !== null) &&
    new Set(tamanos).size < items.length;

  const grupos = new Map<number | null, Item[]>();
  for (const item of items) {
    const clave = agrupar ? tamanoEnMl(item.name) : null;
    grupos.set(clave, [...(grupos.get(clave) ?? []), item]);
  }
  const ordenados = Array.from(grupos.entries()).sort(([a], [b]) => (a ?? 0) - (b ?? 0));

  return (
    <section className="space-y-4 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-foreground/80">
            <Icon size={20} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold">{SUPPLIER_CATEGORY_LABELS[category]}</h3>
            <p className="text-lg font-semibold tabular-nums">{formatTotales(totalesPorUnidad(items, stocks))}</p>
          </div>
        </div>
        {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
      </div>

      <div className="space-y-5">
        {ordenados.map(([tamano, grupo]) => {
          const filas = grupo
            .map((item) => ({ item, ...estadoDe(item, stocks) }))
            .sort((a, b) => (a.stock > 0 ? 0 : 1) - (b.stock > 0 ? 0 : 1) || compareItemsBySize(a.item, b.item));
          return (
            <div key={tamano ?? "todos"} className="space-y-2">
              {agrupar && (
                <div className="flex items-baseline justify-between gap-3 border-b border-foreground/10 pb-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground/50">{tamano} ml</h4>
                  <span className="text-xs tabular-nums text-foreground/50">{formatTotales(totalesPorUnidad(grupo, stocks))}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {filas.map(({ item, stock, negativo, bajoMinimo }) => (
                  <Link
                    key={item.id}
                    href={`/stock/${item.slug}`}
                    title={
                      bajoMinimo && item.minStock
                        ? `Por debajo del mínimo (${formatQuantity(item.minStock, item.unit)})`
                        : item.name
                    }
                    className={`flex min-w-0 flex-col justify-between rounded-lg border px-3 py-2.5 transition-colors hover:border-primary hover:bg-foreground/[0.02] ${
                      negativo
                        ? "border-red-300 dark:border-red-900/60"
                        : bajoMinimo
                          ? "border-amber-300 dark:border-amber-900/60"
                          : "border-foreground/10"
                    } ${stock === 0 ? "opacity-50" : ""}`}
                  >
                    <p className="line-clamp-2 text-sm leading-snug text-foreground/70">{nombreCorto(item.name, agrupar)}</p>
                    <p
                      className={`mt-1 text-lg font-semibold tabular-nums ${
                        negativo ? "text-red-600 dark:text-red-400" : bajoMinimo ? "text-amber-600 dark:text-amber-400" : ""
                      }`}
                    >
                      {formatQuantity(stock)}{" "}
                      <span className="text-xs font-normal text-foreground/50">{unidadEnPlural(item.unit, stock)}</span>
                    </p>
                    {bajoMinimo && <p className="text-xs text-amber-700 dark:text-amber-400">Bajo el mínimo</p>}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function VolverAInsumos() {
  return (
    <Link href="/stock" className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground">
      <ArrowLeft size={14} /> Todos los insumos
    </Link>
  );
}
