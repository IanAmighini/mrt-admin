import Link from "next/link";
import { FormConError } from "@/components/FormConError";
import { BotonConError } from "@/components/BotonConError";
import { notFound, redirect } from "next/navigation";
import type { SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { findBySlugOrId } from "@/lib/slug-lookup";
import { getProductMovements, getProductStock } from "@/lib/stock";
import { formatNumeroExacto, formatQuantity } from "@/lib/money";
import { CAJA_MOVEMENT_TYPE_LABELS, PRODUCT_MOVEMENT_TYPE_LABELS } from "@/lib/labels";
import { formatPallets } from "@/lib/product-label";
import { formatFecha, hoyEnInput } from "@/lib/period";
import {
  createProductMovement,
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
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";
  // El ajuste de stock es solo de Admin: ver createProductMovement.
  const canAdjust = user.role === "ADMIN";

  const product = await findBySlugOrId(
    () =>
      prisma.product.findUnique({
        where: { slug: productId },
        include: { recipe: { include: { item: true } } },
      }),
    (id) =>
      prisma.product.findUnique({
        where: { id },
        include: { recipe: { include: { item: true } } },
      }),
    productId
  );
  if (!product) notFound();
  if (productId !== product.slug) redirect(`/produccion/${product.slug}`);

  const [stock, movements, items, caja] = await Promise.all([
    getProductStock(product.id),
    getProductMovements(product.id),
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    product.cajaId
      ? prisma.caja.findUnique({
          where: { id: product.cajaId },
          include: {
            movimientos: { include: { createdBy: { select: { name: true } } } },
            products: { select: { presentation: true } },
          },
        })
      : null,
  ]);
  const sueltas = caja ? caja.movimientos.reduce((a, m) => a + m.quantity, 0) : 0;

  // El kardex junta los pallets de este formato y las cajas sueltas de su caja: son el mismo
  // producto, y un desarmado se ve como las dos mitades de lo mismo, en el mismo día.
  type Renglon = { id: string; date: Date; createdAt: Date; tipo: string; cantidad: string; negativo: boolean; motivo: string; usuario: string };
  const kardex: Renglon[] = [
    ...movements.map((m) => ({
      id: m.id,
      date: m.date,
      createdAt: m.createdAt,
      tipo: PRODUCT_MOVEMENT_TYPE_LABELS[m.type],
      cantidad: `${m.quantity.greaterThan(0) ? "+" : ""}${formatPallets(m.quantity, product.boxesPerPallet)}`,
      negativo: m.quantity.isNegative(),
      motivo: m.reason,
      usuario: m.createdBy.name,
    })),
    ...(caja?.movimientos ?? []).map((m) => ({
      id: m.id,
      date: m.date,
      createdAt: m.createdAt,
      tipo: `${CAJA_MOVEMENT_TYPE_LABELS[m.type]} · cajas sueltas`,
      cantidad: `${m.quantity > 0 ? "+" : ""}${formatQuantity(m.quantity)} ${Math.abs(m.quantity) === 1 ? "caja" : "cajas"}`,
      negativo: m.quantity < 0,
      motivo: m.reason,
      usuario: m.createdBy.name,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime());

  /** Cada rol del generador es una categoría de insumo. Filtrar no es cosmético: la sustitución al
   * producir y la limpieza de la receta deciden por categoría, así que una caja archivada bajo
   * TAPAS por un mal clic haría fallar las dos en silencio. */
  function itemsPorCategoria(category: SupplierCategory) {
    // Los que no llevan stock quedan afuera: consumirlos no descontaría de ningún lado, así que
    // ponerlos en una receta sería anotar un consumo que no existe.
    return items.filter((item) => item.category === category && item.llevaStock);
  }

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
          <div className="text-right">
            <p className="text-lg font-semibold">{formatPallets(stock, product.boxesPerPallet)}</p>
            {/* Las cajas sueltas son de la caja, no de este formato: las comparten todos los
                pallets de la misma marca y botella, y se dice cuáles para que no se lean dos veces. */}
            {caja && (
              <p className="text-sm text-foreground/60">
                + {formatQuantity(sueltas)} {sueltas === 1 ? "caja suelta" : "cajas sueltas"}
                {caja.products.length > 1 && (
                  <span className="block text-xs text-foreground/40">
                    de la caja {caja.unitsPerBox}x{formatQuantity(caja.bottleCapacityMl)}, compartidas con{" "}
                    {caja.products.map((p) => p.presentation).filter((x) => x !== product.presentation).join(", ")}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {canEdit && (
        <FormConError
          action={updateProduct}
          submitLabel="Guardar cambios"
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
                defaultValue={formatNumeroExacto(product.bottleCapacityMl)}
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
          </div>
        </FormConError>
      )}

      {canEdit && product.boxesPerPallet && product.unitsPerBox && (
        <FormConError
          action={generateRecipeFromPresentation}
          submitLabel="Generar receta"
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
                {itemsPorCategoria("PALLET_NORMALIZADO").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Botella / bidón">
              <select name="bottleItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {itemsPorCategoria("ENVASES").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tapa">
              <select name="capItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {itemsPorCategoria("TAPAS").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Etiqueta">
              <select name="labelItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {itemsPorCategoria("ETIQUETAS").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Caja">
              <select name="boxItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {itemsPorCategoria("CAJAS").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Aceite">
              <select name="oilItemId" defaultValue="" className={selectClass}>
                <option value="">— No aplica —</option>
                {itemsPorCategoria("ACEITE").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </FormConError>
      )}

      {canEdit && (
        <FormConError
          action={upsertRecipeLine}
          submitLabel="Guardar"
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
        </FormConError>
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
                      <BotonConError
                        action={deleteRecipeLine}
                        hidden={{ recipeItemId: line.id, productId: product.id }}
                        className="text-xs underline underline-offset-2"
                      >
                        Quitar
                      </BotonConError>
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

      {canAdjust && (
        <FormConError
          action={createProductMovement}
          submitLabel="Registrar movimiento"
          className="grid max-w-xl gap-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4"
        >
          <h2 className="text-sm font-semibold">Ajustar el stock</h2>
          <p className="text-xs text-foreground/50">
            Mueve sólo el producto terminado: no descuenta insumos. Es para el saldo inicial, las
            roturas y lo que aparece o falta después de un conteo. Lo que se envasa va por
            Producción, y armar o desarmar pallets también.
          </p>
          <input type="hidden" name="productId" value={product.id} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <select name="type" defaultValue="AJUSTE" className={selectClass}>
                <option value="AJUSTE">Ajuste</option>
                <option value="MERMA">Merma (rotura)</option>
              </select>
            </Field>
            <Field label="Fecha">
              <input
                type="date"
                name="date"
                required
                defaultValue={hoyEnInput()}
                className={selectClass}
              />
            </Field>
            <Field label="Cantidad">
              <div className="flex gap-2">
                <input name="quantity" required inputMode="numeric" className={selectClass} />
                <select name="unidad" defaultValue="PALLETS" className={`${selectClass} w-auto`}>
                  <option value="PALLETS">pallets</option>
                  <option value="CAJAS">cajas sueltas</option>
                </select>
              </div>
            </Field>
            <Field label="Efecto (sólo el ajuste)">
              <select name="effect" defaultValue="SUMA" className={selectClass}>
                <option value="SUMA">Suma al stock</option>
                <option value="RESTA">Resta del stock</option>
              </select>
            </Field>
          </div>
          <Field label="Motivo">
            <input
              name="reason"
              required
              placeholder="Conteo físico, stock inicial, pallet roto…"
              className={selectClass}
            />
          </Field>
        </FormConError>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2">Kardex</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2 pr-4">Cantidad</th>
                <th className="py-2 pr-4">Motivo</th>
                <th className="py-2 pr-4">Usuario</th>
              </tr>
            </thead>
            <tbody>
              {kardex.map((m) => (
                <tr key={m.id} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">{formatFecha(m.date)}</td>
                  <td className="py-2 pr-4">{m.tipo}</td>
                  <td className={`py-2 pr-4 tabular-nums ${m.negativo ? "text-red-600 dark:text-red-400" : ""}`}>
                    {m.cantidad}
                  </td>
                  <td className="py-2 pr-4">{m.motivo}</td>
                  <td className="py-2 pr-4">{m.usuario}</td>
                </tr>
              ))}
              {kardex.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-foreground/40">
                    Sin movimientos todavía.
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
