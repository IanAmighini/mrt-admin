import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { findBySlugOrId } from "@/lib/slug-lookup";
import { getItemMovements, getItemStock } from "@/lib/stock";
import { formatMoney, formatNumeroExacto, formatQuantity } from "@/lib/money";
import { ITEM_MOVEMENT_TYPE_LABELS } from "@/lib/labels";
import { borrarMovimientoDeInsumo, createItemMovement, venderInsumo } from "./actions";
import { DeleteButton } from "@/components/DeleteButton";
import { FormConError } from "@/components/FormConError";
import { KilosALitros } from "@/components/KilosALitros";
import { FormModal } from "@/components/Modal";
import { formatFecha, hoyEnInput } from "@/lib/period";
import { updateItemAjustes } from "../actions";

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
    prisma.preforma.findMany({ orderBy: { name: "asc" } }),
    prisma.entity.findMany({
      // "Ambos" queda afuera a propósito: en ese caso no se puede deducir si la venta se cobra o
      // se descuenta, y hoy no existe ninguna. La acción tira un error claro si llegara a pasar.
      where: { type: { in: ["CLIENTE", "PROVEEDOR"] } },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const movementsDesc = movements.slice().reverse();

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
              <FormModal triggerLabel="Vender" title={`Vender ${item.name}`} action={venderInsumo}>
                <input type="hidden" name="itemId" value={item.id} />
                <p className="text-xs text-foreground/50">
                  Descuenta el stock y carga la plata en la cuenta corriente de quien lo recibe. Si
                  es un proveedor se le descuenta de lo que se le debe; si es un cliente, se le
                  suma a lo que nos debe.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm" htmlFor="venta-fecha">
                      Fecha
                    </label>
                    <input
                      id="venta-fecha"
                      type="date"
                      name="date"
                      required
                      defaultValue={hoyEnInput()}
                      className={inputClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm" htmlFor="venta-entidad">
                      A quién
                    </label>
                    <select id="venta-entidad" name="entityId" required defaultValue="" className={inputClass}>
                      <option value="" disabled>
                        — Elegir —
                      </option>
                      {entidades.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm" htmlFor="venta-cantidad">
                      Cantidad ({item.unit})
                    </label>
                    <input id="venta-cantidad" name="quantity" required inputMode="decimal" className={inputClass} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm" htmlFor="venta-precio">
                      Precio unitario
                    </label>
                    <input id="venta-precio" name="unitPrice" required inputMode="decimal" className={inputClass} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm" htmlFor="venta-circuito">
                      Circuito
                    </label>
                    <select id="venta-circuito" name="circuit" defaultValue="BLANCO" className={inputClass}>
                      <option value="BLANCO">Blanco (facturado)</option>
                      <option value="NEGRO">Negro (sin facturar)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm" htmlFor="venta-numero">
                      Comprobante (opcional)
                    </label>
                    <input id="venta-numero" name="number" className={inputClass} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm" htmlFor="venta-notas">
                    Notas
                  </label>
                  <input id="venta-notas" name="notes" className={inputClass} />
                </div>
                <button
                  type="submit"
                  className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
                >
                  Registrar venta
                </button>
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
          <input type="hidden" name="itemId" value={item.id} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="type">
                Tipo
              </label>
              <select
                id="type"
                name="type"
                required
                defaultValue="INGRESO"
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              >
                <option value="INGRESO">Ingreso</option>
                <option value="AJUSTE">Ajuste</option>
                <option value="MERMA">Merma</option>
                <option value="VENTA">Venta</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="date">
                Fecha
              </label>
              <input
                id="date"
                type="date"
                name="date"
                required
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="quantity">
                Cantidad ({item.unit})
              </label>
              <input
                id="quantity"
                name="quantity"
                inputMode="decimal"
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="effect">
                Efecto (Ajuste / Merma)
              </label>
              <select
                id="effect"
                name="effect"
                defaultValue="RESTA"
                className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
              >
                <option value="SUMA">Suma al stock</option>
                <option value="RESTA">Resta al stock</option>
              </select>
            </div>
          </div>
          {/* Sólo el aceite entra por kilos: es lo que dice el ticket de la balanza. */}
          {item.category === "ACEITE" && (
            <KilosALitros
              id="sourceKg"
              className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
            />
          )}
          <div className="space-y-1">
            <label className="text-sm" htmlFor="reason">
              Motivo
            </label>
            <input
              id="reason"
              name="reason"
              required
              placeholder="Compra a proveedor X, conteo físico, rotura..."
              className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
            />
          </div>
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
                <th className="py-2 w-10" />
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
                        ({formatQuantity(m.sourceKg, "kg")} ÷ 0,91)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{m.reason}</td>
                  <td className="py-2 pr-4">{m.createdBy.name}</td>
                  {/* Sólo los movimientos sueltos. El que trae una compra o el que descuenta una
                      producción se corrigen en su origen, que reescribe el movimiento solo; un
                      botón acá dejaría la compra diciendo que entró algo que el stock no tiene. */}
                  <td className="py-2">
                    {canEdit && !m.documentId && !m.productionLineId && (
                      <DeleteButton
                        action={borrarMovimientoDeInsumo}
                        hiddenName="movementId"
                        hiddenValue={m.id}
                        nombre={`el ${ITEM_MOVEMENT_TYPE_LABELS[m.type].toLowerCase()} de ${formatQuantity(m.quantity, item.unit)} del ${formatFecha(m.date)}`}
                        consecuencia="El stock vuelve a lo que era antes de esta carga."
                      />
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

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
