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
import { formatFecha, toDateInputValue } from "@/lib/period";
import { AjusteProductoFields, type AjusteProductoDefaults } from "@/components/AjusteProductoFields";
import {
  borrarMovimientoDeProducto,
  createProductMovement,
  editarMovimientoDeProducto,
  deleteRecipeLine,
  restaurarRecetaAutomatica,
  updateProduct,
  updateRecipeLine,
  upsertRecipeLine,
} from "./actions";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { SUPPLIER_CATEGORY_LABELS, SUPPLIER_CATEGORY_ORDER } from "@/lib/labels";
import { ordenarLineas } from "@/lib/recetas";
import { APILADA } from "@/components/ui/Table";

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
  const canEditReceta = user.role === "ADMIN";

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
  const botellasSueltas = caja ? caja.movimientos.reduce((a, m) => a + m.botellas, 0) : 0;

  // El kardex junta los pallets de este formato y las cajas sueltas de su caja: son el mismo
  // producto, y un desarmado se ve como las dos mitades de lo mismo, en el mismo día.
  type Renglon = {
    id: string;
    date: Date;
    createdAt: Date;
    tipo: string;
    cantidad: string;
    negativo: boolean;
    motivo: string;
    usuario: string;
    /** Un ajuste o una merma cargados a mano: lo único que se corrige o se borra desde acá. */
    editable: AjusteProductoDefaults | null;
  };
  const editable = (
    m: { id: string; type: string; date: Date; reason: string; productionLineId: string | null; documentLineId: string | null },
    kind: "PALLETS" | "CAJAS",
    cantidad: number
  ): AjusteProductoDefaults | null =>
    (m.type === "AJUSTE" || m.type === "MERMA") && !m.productionLineId && !m.documentLineId
      ? {
          movementId: m.id,
          kind,
          type: m.type,
          date: toDateInputValue(m.date),
          quantity: formatNumeroExacto(Math.abs(cantidad)),
          effect: cantidad < 0 ? "RESTA" : "SUMA",
          reason: m.reason,
        }
      : null;
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
      editable: editable(m, "PALLETS", m.quantity.toNumber()),
    })),
    ...(caja?.movimientos ?? []).map((m) => ({
      id: m.id,
      date: m.date,
      createdAt: m.createdAt,
      tipo: `${CAJA_MOVEMENT_TYPE_LABELS[m.type]} · cajas sueltas`,
      cantidad: [
        m.quantity !== 0 || m.botellas === 0
          ? `${m.quantity > 0 ? "+" : ""}${formatQuantity(m.quantity)} ${Math.abs(m.quantity) === 1 ? "caja" : "cajas"}`
          : null,
        m.botellas !== 0
          ? `${m.botellas > 0 ? "+" : ""}${formatQuantity(m.botellas)} ${Math.abs(m.botellas) === 1 ? "botella" : "botellas"}`
          : null,
      ]
        .filter(Boolean)
        .join(", "),
      negativo: m.quantity < 0 || (m.quantity === 0 && m.botellas < 0),
      motivo: m.reason,
      usuario: m.createdBy.name,
      editable: m.botellas === 0 ? editable(m, "CAJAS", m.quantity) : null,
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

  const receta = ordenarLineas(product.recipe.map((r) => ({ ...r, categoria: r.item.category, nombre: r.item.name })));

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
                {botellasSueltas !== 0 && (
                  <>
                    {" "}
                    + {formatQuantity(botellasSueltas)} {botellasSueltas === 1 ? "botella suelta" : "botellas sueltas"}
                  </>
                )}
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

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Receta por pallet</h2>
            <p className="text-sm text-foreground/60">
              Lo que se descuenta de insumos por cada pallet que se carga en Producción.
              {!canEditReceta && " Sólo el admin la puede cambiar."}
            </p>
          </div>
          {canEditReceta && (
            <div className="flex flex-wrap items-center gap-2">
              <FormModal triggerLabel="Agregar insumo" title="Agregar insumo a la receta" action={upsertRecipeLine} peso="secundario">
                <input type="hidden" name="productId" value={product.id} />
                <Field label="Insumo">
                  <select name="itemId" required defaultValue="" className={selectClass}>
                    <option value="" disabled>
                      — Elegí un insumo —
                    </option>
                    {SUPPLIER_CATEGORY_ORDER.map((categoria) => {
                      const deCategoria = itemsPorCategoria(categoria);
                      if (deCategoria.length === 0) return null;
                      return (
                        <optgroup key={categoria} label={SUPPLIER_CATEGORY_LABELS[categoria]}>
                          {deCategoria.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </Field>
                <Field label="Cantidad por pallet">
                  <input name="quantityPerUnit" required inputMode="decimal" className={selectClass} />
                </Field>
                <p className="text-xs text-foreground/50">Si el insumo ya está en la receta, se le cambia la cantidad.</p>
                <button type="submit" className={botonPrimario}>
                  Agregar
                </button>
              </FormModal>
              <BotonConError
                action={restaurarRecetaAutomatica}
                hidden={{ productId: product.id }}
                className="rounded-lg px-4 py-2 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                Volver a la automática
              </BotonConError>
            </div>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
          <table className={`w-full text-sm ${APILADA} max-sm:[&_tr]:px-4`}>
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 px-4">Qué</th>
                <th className="py-2 px-4">Insumo</th>
                <th className="py-2 px-4 text-right">Por pallet</th>
                {canEditReceta && <th className="py-2 px-4"></th>}
              </tr>
            </thead>
            <tbody>
              {receta.map((line) => (
                <tr key={line.id} className="border-b border-foreground/5 last:border-0">
                  <td className="py-2 px-4 text-foreground/60">{SUPPLIER_CATEGORY_LABELS[line.item.category]}</td>
                  <td className="py-2 px-4 font-medium">{line.item.name}</td>
                  <td className="py-2 px-4 text-right tabular-nums">{formatQuantity(line.quantityPerUnit, line.item.unit)}</td>
                  {canEditReceta && (
                    <td className="py-2 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <FormModal
                          triggerLabel="Cambiar"
                          soloIcono
                          iconName="edit"
                          title={`Cambiar ${line.item.name}`}
                          action={updateRecipeLine}
                        >
                          <input type="hidden" name="recipeItemId" value={line.id} />
                          <Field label="Insumo">
                            <select name="itemId" required defaultValue={line.itemId} className={selectClass}>
                              {itemsPorCategoria(line.item.category).map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label={`Cantidad por pallet (${line.item.unit})`}>
                            <input
                              name="quantityPerUnit"
                              required
                              inputMode="decimal"
                              defaultValue={formatNumeroExacto(line.quantityPerUnit)}
                              className={selectClass}
                            />
                          </Field>
                          <button type="submit" className={botonPrimario}>
                            Guardar
                          </button>
                        </FormModal>
                        <DeleteButton
                          action={deleteRecipeLine}
                          hiddenName="recipeItemId"
                          hiddenValue={line.id}
                          nombre={`${line.item.name} de la receta`}
                          consecuencia="Las próximas producciones de este producto no lo van a descontar."
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {receta.length === 0 && (
                <tr>
                  <td colSpan={canEditReceta ? 4 : 3} className="py-6 text-center text-foreground/40">
                    Todavía no tiene receta: se arma sola la primera vez que se produce.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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
          <AjusteProductoFields productId={product.id} />
        </FormConError>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2">Kardex</h2>
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${APILADA}`}>
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2 pr-4">Cantidad</th>
                <th className="py-2 pr-4">Motivo</th>
                <th className="py-2 pr-4">Usuario</th>
                {canAdjust && <th className="py-2 w-16" />}
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
                  {canAdjust && (
                    <td className="py-2">
                      {m.editable && (
                        <div className="flex items-center gap-1">
                          <FormModal
                            triggerLabel="Editar"
                            soloIcono
                            iconName="edit"
                            title={`Corregir ${m.tipo.toLowerCase()}`}
                            action={editarMovimientoDeProducto}
                          >
                            <AjusteProductoFields productId={product.id} defaults={m.editable} />
                            <button type="submit" className={botonPrimario}>
                              Guardar cambios
                            </button>
                          </FormModal>
                          <DeleteButton
                            action={borrarMovimientoDeProducto}
                            hiddenName="movementId"
                            hiddenValue={m.id}
                            nombre={`${m.tipo.toLowerCase()} de ${m.cantidad} del ${formatFecha(m.date)}`}
                            consecuencia="El stock vuelve a lo que era antes de esta carga."
                          >
                            <input type="hidden" name="productId" value={product.id} />
                            <input type="hidden" name="kind" value={m.editable.kind} />
                          </DeleteButton>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {kardex.length === 0 && (
                <tr>
                  <td colSpan={canAdjust ? 6 : 5} className="py-4 text-center text-foreground/40">
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

const botonPrimario =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
