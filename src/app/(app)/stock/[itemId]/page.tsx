import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { findBySlugOrId } from "@/lib/slug-lookup";
import { getItemMovements, getItemStock } from "@/lib/stock";
import { formatMoney, formatNumeroExacto, formatQuantity } from "@/lib/money";
import { DENSIDAD_ACEITE } from "@/lib/aceite";
import { getPreformasOrdenadas } from "@/lib/preformas";
import { ITEM_MOVEMENT_TYPE_LABELS } from "@/lib/labels";
import {
  borrarMovimientoDeInsumo,
  borrarVentaDeInsumo,
  createItemMovement,
  editarMovimientoDeInsumo,
  editarVentaDeInsumo,
  venderInsumo,
} from "./actions";
import { MovimientoInsumoFields } from "@/components/MovimientoInsumoFields";
import { VentaInsumoFields, type VentaInsumoDefaults } from "@/components/VentaInsumoFields";
import { DeleteButton } from "@/components/DeleteButton";
import { FormConError } from "@/components/FormConError";
import { FormModal } from "@/components/Modal";
import { formatFecha, toDateInputValue } from "@/lib/period";
import { updateItemAjustes } from "../actions";
import { APILADA } from "@/components/ui/Table";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const item = await findBySlugOrId(
    () => prisma.item.findUnique({ where: { slug: itemId } }),
    (id) => prisma.item.findUnique({ where: { id } }),
    itemId
  );
  if (!item) notFound();
  if (itemId !== item.slug) redirect(`/stock/${item.slug}`);

  const [stock, movements, preformas, entidades] = await Promise.all([
    getItemStock(item.id),
    getItemMovements(item.id),
    // Sólo se usa en el formulario de envases, pero pedirla siempre evita una consulta condicional
    // por tres filas.
    getPreformasOrdenadas(),
    prisma.entity.findMany({
      // "Ambos" queda afuera a propósito: en ese caso no se puede deducir si la venta se cobra o
      // se descuenta, y hoy no existe ninguna. La acción tira un error claro si llegara a pasar.
      where: { type: { in: ["CLIENTE", "PROVEEDOR"] } },
      select: { id: true, name: true, type: true, moneda: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const movementsDesc = movements.slice().reverse();

  // Las ventas del historial, para poder corregirlas desde acá: el formulario arranca con lo que
  // se cargó.
  const ventas = new Map(
    (
      await prisma.document.findMany({
        where: { id: { in: movements.filter((m) => m.type === "VENTA" && m.documentId).map((m) => m.documentId!) } },
        include: { account: true },
      })
    ).map((d) => [d.id, d])
  );
  const defaultsDeVenta = (m: (typeof movements)[number]): VentaInsumoDefaults | null => {
    const d = m.documentId ? ventas.get(m.documentId) : undefined;
    if (!d) return null;
    const cantidad = m.quantity.negated();
    return {
      documentId: d.id,
      entityId: d.account.entityId,
      circuit: d.account.circuit,
      date: toDateInputValue(d.date),
      quantity: formatNumeroExacto(cantidad),
      unitPrice: cantidad.isZero() ? "" : formatNumeroExacto(d.totalAmount.dividedBy(cantidad).toDecimalPlaces(4)),
      number: d.number,
      notes: d.reason?.split(" — ").slice(1).join(" — ") ?? "",
    };
  };

  return (
    <div className="space-y-8">
      <div>
        <Link href="/stock" className="text-sm underline underline-offset-2">
          ← Stock de insumos
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">{item.name}</h1>
          <div className="flex items-center gap-4">
            <p className="text-lg font-semibold">{formatQuantity(stock, item.unit)}</p>
            {canEdit && item.llevaStock && (
              <FormModal triggerLabel="Vender" title={`Vender ${item.name}`} action={venderInsumo} maxWidthClass="max-w-xl">
                <VentaInsumoFields itemId={item.id} unidad={item.unit} entidades={entidades} />
              </FormModal>
            )}
          </div>
        </div>
        <p className="mt-1 text-sm text-foreground/60">
          Costo unitario: {item.unitCost ? formatMoney(item.unitCost) : "sin cargar"} · Stock mínimo:{" "}
          {item.minStock ? formatQuantity(item.minStock, item.unit) : "sin definir"}
        </p>
      </div>

      {canEdit && (
        <FormConError
          action={updateItemAjustes}
          submitLabel="Guardar"
          pendingLabel="Guardando…"
          className="flex flex-wrap items-end gap-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4"
        >
          <input type="hidden" name="itemId" value={item.id} />
          <div className="space-y-1">
            <label className="text-sm" htmlFor="unitCost">
              Costo unitario
            </label>
            <input
              id="unitCost"
              name="unitCost"
              required
              inputMode="decimal"
              defaultValue={formatNumeroExacto(item.unitCost)}
              className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="minStock">
              Stock mínimo ({item.unit})
            </label>
            <input
              id="minStock"
              name="minStock"
              inputMode="decimal"
              placeholder="sin mínimo"
              defaultValue={formatNumeroExacto(item.minStock)}
              className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
            />
          </div>
          {item.category === "ENVASES" && (
            <>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="preformaId">
                  Preforma
                </label>
                <select
                  id="preformaId"
                  name="preformaId"
                  defaultValue={item.preformaId ?? ""}
                  className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
                >
                  <option value="">— Sin preforma —</option>
                  {preformas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="unitsPerPallet">
                  Unidades por pallet
                </label>
                <input
                  id="unitsPerPallet"
                  name="unitsPerPallet"
                  inputMode="numeric"
                  placeholder="1.944"
                  defaultValue={formatNumeroExacto(item.unitsPerPallet)}
                  className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="precioSopladoUsd">
                  Soplado (U$S por unidad)
                </label>
                <input
                  id="precioSopladoUsd"
                  name="precioSopladoUsd"
                  inputMode="decimal"
                  placeholder="0,0425"
                  defaultValue={formatNumeroExacto(item.precioSopladoUsd)}
                  className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
                />
              </div>
            </>
          )}
          <label className="flex items-center gap-2 self-center text-sm">
            <input type="checkbox" name="llevaStock" defaultChecked={item.llevaStock} />
            Lleva stock
          </label>
          <p className="w-full text-xs text-foreground/50">
            Dejá el mínimo vacío para que este insumo no aparezca en el control de faltantes.
            {item.category === "ENVASES" &&
              " Las unidades por pallet son las del pallet descartable con el que llega, y sirven para cargar el remito; ese pallet no entra a stock."}
          </p>
        </FormConError>
      )}

      {canEdit && (
        <FormConError
          action={createItemMovement}
          className="grid max-w-xl gap-3 rounded-xl border border-foreground/10 bg-background shadow-sm p-4"
          submitLabel="Registrar movimiento"
          pendingLabel="Registrando…"
        >
          <h2 className="text-sm font-semibold">Nuevo movimiento</h2>
          <MovimientoInsumoFields itemId={item.id} unidad={item.unit} esAceite={item.category === "ACEITE"} />
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
                <th className="py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {movementsDesc.map((m) => (
                <tr key={m.id} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">{formatFecha(m.date)}</td>
                  <td className="py-2 pr-4">{ITEM_MOVEMENT_TYPE_LABELS[m.type]}</td>
                  <td className="py-2 pr-4">
                    {m.quantity.greaterThan(0) ? "+" : ""}
                    {formatQuantity(m.quantity, item.unit)}
                    {m.sourceKg && (
                      <span className="text-foreground/40">
                        {" "}
                        ({formatQuantity(m.sourceKg, "kg")} ÷ {formatNumeroExacto(m.conversionFactor ?? DENSIDAD_ACEITE)})
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{m.reason}</td>
                  <td className="py-2 pr-4">{m.createdBy.name}</td>
                  {/* Sólo los movimientos sueltos. El que trae una compra o el que descuenta una
                      producción se corrigen en su origen, que reescribe el movimiento solo; un
                      botón acá dejaría la compra diciendo que entró algo que el stock no tiene. */}
                  <td className="py-2">
                    {canEdit && m.type === "VENTA" && defaultsDeVenta(m) && (
                      <div className="flex items-center gap-1">
                        <FormModal
                          triggerLabel="Editar"
                          soloIcono
                          iconName="edit"
                          title={`Editar venta de ${item.name}`}
                          action={editarVentaDeInsumo}
                          maxWidthClass="max-w-xl"
                        >
                          <VentaInsumoFields
                            itemId={item.id}
                            unidad={item.unit}
                            entidades={entidades}
                            defaults={defaultsDeVenta(m)!}
                          />
                        </FormModal>
                        <DeleteButton
                          action={borrarVentaDeInsumo}
                          hiddenName="documentId"
                          hiddenValue={m.documentId!}
                          nombre={`la venta de ${formatQuantity(m.quantity.negated(), item.unit)} del ${formatFecha(m.date)}`}
                          consecuencia="El insumo vuelve al stock y se saca de la cuenta de quien lo compró."
                        />
                      </div>
                    )}
                    {canEdit && !m.documentId && !m.productionLineId && (
                      <div className="flex items-center gap-1">
                        <FormModal
                          triggerLabel="Editar"
                          soloIcono
                          iconName="edit"
                          title={`Corregir ${ITEM_MOVEMENT_TYPE_LABELS[m.type].toLowerCase()} de ${item.name}`}
                          action={editarMovimientoDeInsumo}
                        >
                          <MovimientoInsumoFields
                            itemId={item.id}
                            unidad={item.unit}
                            esAceite={item.category === "ACEITE"}
                            defaults={{
                              movementId: m.id,
                              type: m.type,
                              date: toDateInputValue(m.date),
                              quantity: formatNumeroExacto(m.quantity.abs()),
                              effect: m.quantity.isNegative() ? "RESTA" : "SUMA",
                              sourceKg: m.sourceKg ? formatNumeroExacto(m.sourceKg) : "",
                              reason: m.reason,
                            }}
                          />
                          <button
                            type="submit"
                            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
                          >
                            Guardar cambios
                          </button>
                        </FormModal>
                        <DeleteButton
                          action={borrarMovimientoDeInsumo}
                          hiddenName="movementId"
                          hiddenValue={m.id}
                          nombre={`el ${ITEM_MOVEMENT_TYPE_LABELS[m.type].toLowerCase()} de ${formatQuantity(m.quantity, item.unit)} del ${formatFecha(m.date)}`}
                          consecuencia="El stock vuelve a lo que era antes de esta carga."
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {movementsDesc.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-foreground/40">
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
