import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllBoxStocks, getAllProductStocks } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import { PALLET_STATUS_LABELS } from "@/lib/labels";
import { createProduct, createProductionRun, updateOilEfficiency } from "./actions";
import { createBoxType, createBoxMovement, createPallet } from "./pallet-actions";
import { ProductionLinesFields } from "./ProductionLinesFields";
import { getSetting } from "@/lib/settings";

const PALLET_BOX_ROWS = 4;

export default async function ProduccionPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [products, stocks, runs, oilFillEfficiencyPercent, items, boxTypes, boxStocks, pallets] =
    await Promise.all([
      prisma.product.findMany({
        orderBy: { name: "asc" },
        include: { recipe: true },
      }),
      getAllProductStocks(),
      prisma.productionRun.findMany({
        orderBy: { date: "desc" },
        include: { lines: { include: { product: true } }, createdBy: true },
        take: 30,
      }),
      getSetting("oilFillEfficiencyPercent", "100"),
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
        <h1 className="text-xl font-semibold mb-1">Producción</h1>
        <p className="text-sm text-black/60">
          Productos, receta (BOM) y carga de producción diaria.
        </p>
      </div>

      {canEdit && (
        <form
          action={createProduct}
          className="grid max-w-xl gap-3 rounded-lg border border-black/10 p-4"
        >
          <h2 className="text-sm font-semibold">Nuevo producto</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <label className="text-sm" htmlFor="name">
                Marca
              </label>
              <input
                id="name"
                name="name"
                required
                placeholder="Bonanza"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="oilType">
                Tipo de aceite
              </label>
              <input
                id="oilType"
                name="oilType"
                required
                placeholder="Girasol"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="presentation">
                Presentación
              </label>
              <input
                id="presentation"
                name="presentation"
                required
                placeholder="105x12x850"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="boxesPerPallet">
                Cajas por pallet
              </label>
              <input
                id="boxesPerPallet"
                name="boxesPerPallet"
                inputMode="numeric"
                placeholder="105"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="unitsPerBox">
                Botellas por caja
              </label>
              <input
                id="unitsPerBox"
                name="unitsPerBox"
                inputMode="numeric"
                placeholder="12"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="bottleCapacityMl">
                Capacidad de botella (ml)
              </label>
              <input
                id="bottleCapacityMl"
                name="bottleCapacityMl"
                inputMode="decimal"
                placeholder="850"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Crear
          </button>
        </form>
      )}

      <div className="max-w-xs rounded-lg border border-black/10 p-4">
        <h2 className="text-sm font-semibold mb-2">Eficiencia de llenado de aceite</h2>
        <p className="text-xs text-black/50 mb-3">
          Porcentaje del volumen nominal de la botella que realmente se consume en aceite, usado
          al generar la receta de un producto.
        </p>
        {canEdit ? (
          <form action={updateOilEfficiency} className="flex items-center gap-2">
            <input
              name="oilFillEfficiencyPercent"
              defaultValue={oilFillEfficiencyPercent}
              inputMode="decimal"
              className="w-24 rounded border border-black/20 px-3 py-2 text-sm"
            />
            <span className="text-sm">%</span>
            <button
              type="submit"
              className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Guardar
            </button>
          </form>
        ) : (
          <p className="text-lg font-semibold">{oilFillEfficiencyPercent}%</p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-black/60">
              <th className="py-2 pr-4">Producto</th>
              <th className="py-2 pr-4">Tipo de aceite</th>
              <th className="py-2 pr-4">Presentación</th>
              <th className="py-2 pr-4">Insumos en receta</th>
              <th className="py-2 pr-4">Stock actual</th>
            </tr>
          </thead>
          <tbody>
            {products
              .filter((product) => {
                const stock = stocks.get(product.id);
                return stock !== undefined && !stock.isZero();
              })
              .map((product) => (
                <tr key={product.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">
                    <Link href={`/produccion/${product.id}`} className="underline underline-offset-2">
                      {product.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{product.oilType}</td>
                  <td className="py-2 pr-4">{product.presentation}</td>
                  <td className="py-2 pr-4">
                    {product.recipe.length === 0 ? (
                      <span className="text-black/40">Sin receta</span>
                    ) : (
                      product.recipe.length
                    )}
                  </td>
                  <td className="py-2 pr-4">{formatQuantity(stocks.get(product.id) ?? 0)}</td>
                </tr>
              ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-black/40">
                  Todavía no hay productos cargados.
                </td>
              </tr>
            )}
            {products.length > 0 &&
              products.every((product) => {
                const stock = stocks.get(product.id);
                return stock === undefined || stock.isZero();
              }) && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-black/40">
                    No hay stock cargado — todos los productos están en 0.
                  </td>
                </tr>
              )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form
          action={createProductionRun}
          className="space-y-3 rounded-lg border border-black/10 p-4"
        >
          <h2 className="text-sm font-semibold">Parte de producción diaria</h2>
          <div className="space-y-1 max-w-xs">
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
          <ProductionLinesFields products={products.map((p) => ({ id: p.id, name: p.name }))} />
          <button
            type="submit"
            className="w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Registrar parte
          </button>
        </form>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-2">Historial de partes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-black/60">
                <th className="py-2 pr-4">Fecha</th>
                <th className="py-2 pr-4">Producción</th>
                <th className="py-2 pr-4">Cargado por</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-black/5">
                  <td className="py-2 pr-4">{run.date.toLocaleDateString("es-AR")}</td>
                  <td className="py-2 pr-4">
                    {run.lines
                      .map((line) => `${line.product.name}: ${formatQuantity(line.quantity)}`)
                      .join(" · ")}
                  </td>
                  <td className="py-2 pr-4">{run.createdBy.name}</td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-black/40">
                    Sin partes de producción todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="space-y-6 border-t border-black/10 pt-10">
        <div>
          <h2 className="text-lg font-semibold mb-1">Armado de cajas y pallets</h2>
          <p className="text-sm text-black/60">
            Producto suelto → caja armada → pallet armado.
          </p>
        </div>

        {canEdit && (
          <form
            action={createBoxType}
            className="grid max-w-xl gap-3 rounded-lg border border-black/10 p-4"
          >
            <h3 className="text-sm font-semibold">Nuevo tipo de caja</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm" htmlFor="boxProductId">
                  Producto
                </label>
                <select
                  id="boxProductId"
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
                <label className="text-sm" htmlFor="boxLabel">
                  Etiqueta
                </label>
                <input
                  id="boxLabel"
                  name="label"
                  required
                  placeholder="Caja x12"
                  className="w-full rounded border border-black/20 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="boxUnitsPerBox">
                  Unidades por caja
                </label>
                <input
                  id="boxUnitsPerBox"
                  name="unitsPerBox"
                  required
                  inputMode="decimal"
                  className="w-full rounded border border-black/20 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
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
            <h3 className="text-sm font-semibold">Armar cajas</h3>
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
                <label className="text-sm" htmlFor="boxQuantity">
                  Cantidad de cajas
                </label>
                <input
                  id="boxQuantity"
                  name="quantity"
                  required
                  inputMode="decimal"
                  className="w-full rounded border border-black/20 px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="boxDate">
                  Fecha
                </label>
                <input
                  id="boxDate"
                  type="date"
                  name="date"
                  required
                  className="w-full rounded border border-black/20 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="boxReason">
                Motivo
              </label>
              <input
                id="boxReason"
                name="reason"
                required
                placeholder="Armado de cajas para pedido X"
                className="w-full rounded border border-black/20 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Registrar armado
            </button>
          </form>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2">Stock de cajas armadas</h3>
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
          <form action={createPallet} className="space-y-3 rounded-lg border border-black/10 p-4">
            <h3 className="text-sm font-semibold">Armar pallet</h3>
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
                <label className="text-sm" htmlFor="palletLabel">
                  Etiqueta (opcional)
                </label>
                <input
                  id="palletLabel"
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
              className="w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Armar pallet
            </button>
          </form>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2">Pallets</h3>
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
                      <Link
                        href={`/produccion/pallets/${pallet.id}`}
                        className="underline underline-offset-2"
                      >
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
      </section>
    </div>
  );
}
