import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllBoxStocks } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import { PALLET_STATUS_LABELS } from "@/lib/labels";
import { createBoxType, createBoxMovement, createPallet } from "./actions";

const PALLET_BOX_ROWS = 4;

export default async function PalletsPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [products, items, boxTypes, boxStocks, pallets] = await Promise.all([
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    prisma.boxType.findMany({ orderBy: { label: "asc" }, include: { product: true } }),
    getAllBoxStocks(),
    prisma.pallet.findMany({
      orderBy: { date: "desc" },
      include: {
        woodItem: true,
        filmItem: true,
        boxes: { include: { boxType: true } },
      },
      take: 30,
    }),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Pallets</h1>
        <p className="text-sm text-black/60">
          Armado y desarmado de pallets — producto suelto → caja armada → pallet armado.
        </p>
      </div>

      {canEdit && (
        <form
          action={createBoxType}
          className="grid max-w-xl gap-3 rounded-lg border border-black/10 p-4"
        >
          <h2 className="text-sm font-semibold">Nuevo tipo de caja</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="productId">
                Producto
              </label>
              <select
                id="productId"
                name="productId"
                required
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              >
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="label">
                Etiqueta
              </label>
              <input
                id="label"
                name="label"
                required
                placeholder="Caja x12"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="unitsPerBox">
                Unidades por caja
              </label>
              <input
                id="unitsPerBox"
                name="unitsPerBox"
                required
                inputMode="decimal"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-fit rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80"
          >
            Crear
          </button>
        </form>
      )}

      {canEdit && boxTypes.length > 0 && (
        <form
          action={createBoxMovement}
          className="grid max-w-xl gap-3 rounded-lg border border-black/10 p-4"
        >
          <h2 className="text-sm font-semibold">Armar cajas</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="boxTypeId">
                Tipo de caja
              </label>
              <select
                id="boxTypeId"
                name="boxTypeId"
                required
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              >
                {boxTypes.map((boxType) => (
                  <option key={boxType.id} value={boxType.id}>
                    {boxType.label} — {boxType.product.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="quantity">
                Cantidad de cajas
              </label>
              <input
                id="quantity"
                name="quantity"
                required
                inputMode="decimal"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
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
          </div>
          <div className="space-y-1">
            <label className="text-sm" htmlFor="reason">
              Motivo
            </label>
            <input
              id="reason"
              name="reason"
              required
              placeholder="Armado de cajas para pedido X"
              className="w-full rounded border border-black/20 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-fit rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80"
          >
            Registrar armado
          </button>
        </form>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2">Stock de cajas armadas</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Tipo de caja</th>
                <th className="py-2 pr-4">Producto</th>
                <th className="py-2 pr-4">Unidades por caja</th>
                <th className="py-2 pr-4">Stock actual</th>
              </tr>
            </thead>
            <tbody>
              {boxTypes.map((boxType) => (
                <tr key={boxType.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">{boxType.label}</td>
                  <td className="py-2 pr-4">{boxType.product.name}</td>
                  <td className="py-2 pr-4">{formatQuantity(boxType.unitsPerBox)}</td>
                  <td className="py-2 pr-4">
                    {formatQuantity(boxStocks.get(boxType.id) ?? 0, "cajas")}
                  </td>
                </tr>
              ))}
              {boxTypes.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-black/40">
                    Todavía no hay tipos de caja cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canEdit && boxTypes.length > 0 && (
        <form
          action={createPallet}
          className="space-y-3 rounded-lg border border-black/10 p-4"
        >
          <h2 className="text-sm font-semibold">Armar pallet</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="palletDate">
                Fecha
              </label>
              <input
                id="palletDate"
                type="date"
                name="date"
                required
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="palletCount">
                Cantidad de pallets iguales
              </label>
              <input
                id="palletCount"
                name="palletCount"
                type="number"
                min={1}
                defaultValue={1}
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="text-sm" htmlFor="label">
                Etiqueta (opcional)
              </label>
              <input
                id="label"
                name="label"
                placeholder="Pallet marca X"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="woodItemId">
                Insumo: pallet de madera
              </label>
              <select
                id="woodItemId"
                name="woodItemId"
                required
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="filmItemId">
                Insumo: film
              </label>
              <select
                id="filmItemId"
                name="filmItemId"
                required
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="filmQuantity">
                Cantidad de film usada (por pallet)
              </label>
              <input
                id="filmQuantity"
                name="filmQuantity"
                required
                inputMode="decimal"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm">Cajas incluidas</p>
            {Array.from({ length: PALLET_BOX_ROWS }).map((_, i) => (
              <div key={i} className="flex gap-2">
                <select
                  name="boxTypeId"
                  defaultValue=""
                  className="flex-1 rounded border border-black/20 px-3 py-2 text-sm"
                >
                  <option value="">— Tipo de caja —</option>
                  {boxTypes.map((boxType) => (
                    <option key={boxType.id} value={boxType.id}>
                      {boxType.label} — {boxType.product.name}
                    </option>
                  ))}
                </select>
                <input
                  name="boxQuantity"
                  placeholder="Cantidad"
                  inputMode="decimal"
                  className="w-32 rounded border border-black/20 px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>
          <button
            type="submit"
            className="w-fit rounded bg-black px-3 py-2 text-sm font-medium text-white hover:bg-black/80"
          >
            Armar pallet
          </button>
        </form>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2">Pallets</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Etiqueta</th>
                <th className="py-2 pr-4">Cajas</th>
                <th className="py-2 pr-4">Madera / Film</th>
                <th className="py-2 pr-4">Estado</th>
              </tr>
            </thead>
            <tbody>
              {pallets.map((pallet) => (
                <tr key={pallet.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">{pallet.date.toLocaleDateString("es-AR")}</td>
                  <td className="py-2 pr-4">
                    <Link href={`/pallets/${pallet.id}`} className="underline underline-offset-2">
                      {pallet.label || pallet.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {pallet.boxes
                      .map((b) => `${b.boxType.label} × ${formatQuantity(b.quantity)}`)
                      .join(" · ")}
                  </td>
                  <td className="py-2 pr-4">
                    {pallet.woodItem.name} · {formatQuantity(pallet.filmQuantity)}{" "}
                    {pallet.filmItem.name}
                  </td>
                  <td className="py-2 pr-4">{PALLET_STATUS_LABELS[pallet.status]}</td>
                </tr>
              ))}
              {pallets.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-black/40">
                    Todavía no hay pallets armados.
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
