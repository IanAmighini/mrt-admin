import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatQuantity } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";
import { getSetting } from "@/lib/settings";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { ProductionRunFormFields } from "@/components/ProductionRunFormFields";
import { OilEfficiencyFields } from "@/components/OilEfficiencyFields";
import { createProductionRun, deleteProductionRun, updateProductionRun, updateOilEfficiency } from "./actions";
import { toDateInputValue } from "@/lib/period";

export default async function ProduccionPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [runs, oilFillEfficiencyPercent, marcas, formatos, tapas, cajas] = await Promise.all([
    prisma.productionRun.findMany({
      orderBy: { date: "desc" },
      include: {
        lines: { include: { product: { include: { recipe: { include: { item: true } } } } } },
        createdBy: true,
      },
      take: 30,
    }),
    getSetting("oilFillEfficiencyPercent", "100"),
    prisma.marca.findMany({ orderBy: [{ name: "asc" }, { oilType: "asc" }] }),
    prisma.formato.findMany({
      orderBy: [{ bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
      select: { id: true, presentation: true },
    }),
    // Para poder indicar, al cargar la producción, si se usó una tapa o una caja distinta a la de
    // la receta.
    prisma.item.findMany({
      where: { category: "TAPAS" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.item.findMany({
      where: { category: "CAJAS" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

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
          <Link
            href="/produccion/catalogo"
            className="mt-1 inline-block text-sm underline underline-offset-2"
          >
            Ver catálogo (marcas, formatos) →
          </Link>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <FormModal
              triggerLabel="Nueva producción"
              title="Cargar producción"
              action={createProductionRun}
              maxWidthClass="max-w-xl"
            >
              <ProductionRunFormFields marcas={marcas} formatos={formatos} tapas={tapas} cajas={cajas} />
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
                        marcas={marcas}
                        formatos={formatos}
                        tapas={tapas}
                        cajas={cajas}
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
                      <Link
                        href={`/produccion/${line.product.slug}`}
                        className="font-medium underline underline-offset-2"
                      >
                        {formatProductBrandLabel(line.product)}
                      </Link>
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
    </div>
  );
}
