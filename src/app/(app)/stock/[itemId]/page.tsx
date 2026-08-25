import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getItemMovements, getItemStock } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import { ITEM_MOVEMENT_TYPE_LABELS } from "@/lib/labels";
import { createItemMovement } from "./actions";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) notFound();

  const [stock, movements] = await Promise.all([getItemStock(item.id), getItemMovements(item.id)]);
  const movementsDesc = movements.slice().reverse();

  return (
    <div className="space-y-8">
      <div>
        <Link href="/stock" className="text-sm underline underline-offset-2">
          ← Stock de insumos
        </Link>
        <div className="mt-2 flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">{item.name}</h1>
          <p className="text-lg font-semibold">{formatQuantity(stock, item.unit)}</p>
        </div>
      </div>

      {canEdit && (
        <form
          action={createItemMovement}
          className="grid max-w-xl gap-3 rounded-lg border border-black/10 p-4"
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
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
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
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
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
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
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
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              >
                <option value="SUMA">Suma al stock</option>
                <option value="RESTA">Resta al stock</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-black/50">
            Para ingresos de aceite a granel: si cargás Kg + factor de conversión, la cantidad se
            calcula sola (Kg × factor) y pisa el campo de arriba.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="sourceKg">
                Kg (opcional, solo aceite)
              </label>
              <input
                id="sourceKg"
                name="sourceKg"
                inputMode="decimal"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="conversionFactor">
                Factor de conversión Kg→{item.unit}
              </label>
              <input
                id="conversionFactor"
                name="conversionFactor"
                inputMode="decimal"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="reason">
              Motivo
            </label>
            <input
              id="reason"
              name="reason"
              required
              placeholder="Compra a proveedor X, conteo físico, rotura..."
              className="w-full rounded border border-black/20 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-fit rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80"
          >
            Registrar movimiento
          </button>
        </form>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2">Kardex</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2 pr-4">Cantidad</th>
                <th className="py-2 pr-4">Motivo</th>
                <th className="py-2 pr-4">Usuario</th>
              </tr>
            </thead>
            <tbody>
              {movementsDesc.map((m) => (
                <tr key={m.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">{m.date.toLocaleDateString("es-AR")}</td>
                  <td className="py-2 pr-4">{ITEM_MOVEMENT_TYPE_LABELS[m.type]}</td>
                  <td className="py-2 pr-4">
                    {m.quantity.greaterThan(0) ? "+" : ""}
                    {formatQuantity(m.quantity, item.unit)}
                    {m.sourceKg && m.conversionFactor && (
                      <span className="text-black/40">
                        {" "}
                        ({formatQuantity(m.sourceKg, "Kg")} × {m.conversionFactor.toString()})
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{m.reason}</td>
                  <td className="py-2 pr-4">{m.createdBy.name}</td>
                </tr>
              ))}
              {movementsDesc.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-black/40">
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
