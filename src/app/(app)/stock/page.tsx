import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllItemStocks } from "@/lib/stock";
import { formatMoney, formatQuantity } from "@/lib/money";
import { createItem } from "./actions";

export default async function StockPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [items, stocks] = await Promise.all([
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    getAllItemStocks(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">Stock de insumos</h1>
        <p className="text-sm text-black/60">
          El stock se calcula a partir del historial de movimientos (kardex) de cada insumo.
        </p>
      </div>

      {canEdit && (
        <form action={createItem} className="grid max-w-xl gap-3 rounded-lg border border-black/10 p-4">
          <h2 className="text-sm font-semibold">Nuevo insumo</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="name">
                Nombre
              </label>
              <input
                id="name"
                name="name"
                required
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
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
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
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
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
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
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isResellable" />
            Es revendible
          </label>
          <button
            type="submit"
            className="w-fit rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80"
          >
            Crear
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-black/60">
              <th className="py-2 pr-4">Insumo</th>
              <th className="py-2 pr-4">Unidad</th>
              <th className="py-2 pr-4">Stock actual</th>
              <th className="py-2 pr-4">Costo unitario</th>
              <th className="py-2 pr-4">Revendible</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-black/5">
                <td className="py-2 pr-4">
                  <Link href={`/stock/${item.id}`} className="underline underline-offset-2">
                    {item.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">{item.unit}</td>
                <td className="py-2 pr-4">
                  {formatQuantity(stocks.get(item.id) ?? 0, item.unit)}
                </td>
                <td className="py-2 pr-4">{item.unitCost ? formatMoney(item.unitCost) : "—"}</td>
                <td className="py-2 pr-4">{item.isResellable ? "Sí" : "No"}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-black/40">
                  Todavía no hay insumos cargados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
