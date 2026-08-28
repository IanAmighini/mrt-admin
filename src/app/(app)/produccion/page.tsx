import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAllProductStocks } from "@/lib/stock";
import { formatQuantity } from "@/lib/money";
import { formatProductBrandLabel, formatProductLabel } from "@/lib/product-label";
import { getSetting } from "@/lib/settings";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { NewProductFields } from "@/components/NewProductFields";
import { ProductionRunFormFields } from "@/components/ProductionRunFormFields";
import { OilEfficiencyFields } from "@/components/OilEfficiencyFields";
import { createProduct, createProductionRun, deleteProductionRun, updateProductionRun, updateOilEfficiency } from "./actions";

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function ProduccionPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [products, stocks, runs, oilFillEfficiencyPercent] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: "asc" },
      include: { recipe: true },
    }),
    getAllProductStocks(),
    prisma.productionRun.findMany({
      orderBy: { date: "desc" },
      include: {
        lines: { include: { product: { include: { recipe: { include: { item: true } } } } } },
        createdBy: true,
      },
      take: 30,
    }),
    getSetting("oilFillEfficiencyPercent", "100"),
  ]);

  const productFields = products.map((p) => ({
    id: p.id,
    name: p.name,
    oilType: p.oilType,
    presentation: p.presentation,
  }));

  const runTotals = runs.map((run) => {
    let pallets = 0;
    let litros = 0;
    let botellas = 0;
    for (const line of run.lines) {
      const qty = line.quantity.toNumber();
      pallets += qty;
      botellas += qty * (line.product.boxesPerPallet ?? 0) * (line.product.unitsPerBox ?? 0);
      const oilRecipe = line.product.recipe.find((r) => r.item.unit === "L");
      if (oilRecipe) litros += qty * oilRecipe.quantityPerUnit.toNumber();
    }
    return { run, pallets, litros, botellas };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold mb-1">Producción</h1>
          <p className="text-sm text-foreground/60">Historial de producción diaria.</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <FormModal triggerLabel="Nuevo producto" title="Nuevo producto" action={createProduct}>
              <NewProductFields />
            </FormModal>
            <FormModal
              triggerLabel="Nueva producción"
              title="Cargar producción"
              action={createProductionRun}
              maxWidthClass="max-w-xl"
            >
              <ProductionRunFormFields products={productFields} />
            </FormModal>
            <FormModal
              triggerLabel="Rendimiento de aceite"
              title="Rendimiento de aceite"
              action={updateOilEfficiency}
              iconName="edit"
            >
              <OilEfficiencyFields currentPercent={oilFillEfficiencyPercent} />
            </FormModal>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {runTotals.map(({ run, pallets, litros, botellas }) => (
          <div key={run.id} className="rounded-xl border border-foreground/10 bg-background shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 bg-foreground/[0.02] px-4 py-3">
              <div className="flex items-center gap-3">
                <p className="font-semibold">{run.date.toLocaleDateString("es-AR")}</p>
                <span className="text-xs text-foreground/40">
                  {run.lines.length} {run.lines.length === 1 ? "item" : "items"}
                </span>
              </div>
              <div className="flex items-center gap-5 text-sm">
                <span>
                  <span className="font-semibold">{formatQuantity(pallets)}</span>{" "}
                  <span className="text-foreground/50">pallets</span>
                </span>
                <span className="text-orange-600 dark:text-orange-400">
                  <span className="font-semibold">{formatQuantity(litros)}</span> L
                </span>
                <span className="text-blue-600 dark:text-blue-400">
                  <span className="font-semibold">{formatQuantity(botellas)}</span> bot.
                </span>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <FormModal
                      triggerLabel="Editar"
                      title="Editar carga de producción"
                      action={updateProductionRun}
                      maxWidthClass="max-w-xl"
                      iconName="edit"
                    >
                      <ProductionRunFormFields
                        products={productFields}
                        editingRunId={run.id}
                        defaultValues={{ date: toDateInputValue(run.date), notes: run.notes ?? "" }}
                      />
                    </FormModal>
                    <DeleteButton
                      action={deleteProductionRun}
                      hiddenName="runId"
                      hiddenValue={run.id}
                      confirmMessage="¿Borrar esta carga de producción? Revierte el stock de producto e insumos que generó."
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="divide-y divide-foreground/5">
              {run.lines.map((line) => {
                const qty = line.quantity.toNumber();
                return (
                  <div key={line.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <div className="flex items-center gap-4">
                      <span className="font-medium">{formatProductBrandLabel(line.product)}</span>
                      <span className="text-foreground/50">{line.product.presentation}</span>
                    </div>
                    <span
                      className={
                        qty < 0
                          ? "font-semibold text-red-600 dark:text-red-400"
                          : "font-semibold text-green-600 dark:text-green-400"
                      }
                    >
                      {qty > 0 ? "+" : ""}
                      {formatQuantity(qty)}
                    </span>
                  </div>
                );
              })}
            </div>
            {run.notes && (
              <p className="border-t border-foreground/5 px-4 py-2 text-xs text-foreground/50">{run.notes}</p>
            )}
          </div>
        ))}
        {runs.length === 0 && (
          <p className="rounded-xl border border-foreground/10 bg-background shadow-sm px-4 py-8 text-center text-foreground/40">
            Todavía no hay producción cargada.
          </p>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Productos</h2>
        <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 px-4">Producto</th>
                <th className="py-2 px-4">Tipo de aceite</th>
                <th className="py-2 px-4">Presentación</th>
                <th className="py-2 px-4">Insumos en receta</th>
                <th className="py-2 px-4">Stock actual</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-foreground/5 last:border-0">
                  <td className="py-2 px-4">
                    <Link href={`/produccion/${product.id}`} className="underline underline-offset-2">
                      {formatProductLabel(product)}
                    </Link>
                  </td>
                  <td className="py-2 px-4">{product.oilType}</td>
                  <td className="py-2 px-4">{product.presentation}</td>
                  <td className="py-2 px-4">
                    {product.recipe.length === 0 ? (
                      <span className="text-foreground/40">Sin receta</span>
                    ) : (
                      product.recipe.length
                    )}
                  </td>
                  <td className="py-2 px-4">
                    {formatQuantity(stocks.get(product.id) ?? 0, "pallets")}
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-foreground/40">
                    Todavía no hay productos cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
