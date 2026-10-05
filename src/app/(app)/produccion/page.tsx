import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatNumeroExacto, formatQuantity } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";
import { getSetting } from "@/lib/settings";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { ProductionRunFormFields } from "@/components/ProductionRunFormFields";
import { OilEfficiencyFields } from "@/components/OilEfficiencyFields";
import { createProductionRun, deleteProductionRun, updateProductionRun, updateOilEfficiency } from "./actions";
import { formatFecha, toDateInputValue } from "@/lib/period";

export default async function ProduccionPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [runs, oilFillEfficiencyPercent, marcas, formatos, tapas, cajas, etiquetas, aceites] = await Promise.all([
    prisma.productionRun.findMany({
      orderBy: { date: "desc" },
      include: {
        lines: {
          include: {
            product: { include: { recipe: { include: { item: true } } } },
            // Para saber, al editar, si se usó una tapa/caja/etiqueta distinta a la de la receta.
            itemMovements: { include: { item: { select: { id: true, category: true } } } },
          },
        },
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
    // A veces se etiqueta con las de papel en vez de las autoadhesivas, que es lo que dice la receta.
    prisma.item.findMany({
      where: { category: "ETIQUETAS" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Cuando se termina el girasol, se completa con Alto Oleico y la etiqueta sigue diciendo girasol.
    prisma.item.findMany({
      where: { category: "ACEITE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // Qué insumo se usó de cada categoría reemplazable, comparando contra la receta: si lo que se
  // consumió no es lo que la receta dice, fue un reemplazo y hay que dejarlo elegido al editar.
  const REEMPLAZABLES = ["TAPAS", "CAJAS", "ETIQUETAS", "ACEITE"] as const;
  type LineaDeCorrida = (typeof runs)[number]["lines"][number];
  function reemplazosDe(line: LineaDeCorrida) {
    const usado: Partial<Record<(typeof REEMPLAZABLES)[number], string>> = {};
    for (const categoria of REEMPLAZABLES) {
      const enReceta = line.product.recipe.find((r) => r.item.category === categoria);
      const consumido = line.itemMovements.find((m) => m.item.category === categoria);
      if (consumido && enReceta && consumido.item.id !== enReceta.itemId) {
        usado[categoria] = consumido.item.id;
      }
    }
    return usado;
  }

  const marcaIdDe = (p: { name: string; oilType: string }) =>
    marcas.find((m) => m.name === p.name && m.oilType === p.oilType)?.id ?? "";
  const formatoIdDe = (p: { presentation: string }) => formatos.find((f) => f.presentation === p.presentation)?.id ?? "";

  /**
   * Los ítems de una corrida, con la forma que espera el formulario de edición. Los pallets y las
   * cajas sueltas de un mismo producto se guardan en dos líneas y en el formulario son un ítem.
   */
  function filasDe(run: (typeof runs)[number]) {
    const porProducto = new Map<string, ReturnType<typeof filaVaciaDe>>();
    function filaVaciaDe(line: LineaDeCorrida) {
      const usado = reemplazosDe(line);
      return {
        marcaId: marcaIdDe(line.product),
        formatoId: formatoIdDe(line.product),
        pallets: "0",
        cajas: "0",
        tapaUsadaItemId: usado.TAPAS ?? "",
        cajaUsadaItemId: usado.CAJAS ?? "",
        etiquetaUsadaItemId: usado.ETIQUETAS ?? "",
        aceiteUsadoItemId: usado.ACEITE ?? "",
      };
    }
    for (const line of run.lines) {
      if (line.tipo !== "PALLETS" && line.tipo !== "CAJAS") continue;
      // Un mismo producto puede ir en dos ítems con insumos distintos —6 pallets con girasol y 4 con
      // Alto Oleico—, y juntarlos en uno al editar haría perder unos u otros. Se agrupa por producto
      // y por lo que se usó.
      const clave = `${line.productId}|${JSON.stringify(reemplazosDe(line))}`;
      const fila = porProducto.get(clave) ?? filaVaciaDe(line);
      const sumado = (actual: string) => formatNumeroExacto(line.quantity.plus(actual.replace(",", ".")));
      if (line.tipo === "PALLETS") fila.pallets = sumado(fila.pallets);
      else fila.cajas = sumado(fila.cajas);
      porProducto.set(clave, fila);
    }
    return Array.from(porProducto.values());
  }

  function armadosDe(run: (typeof runs)[number]) {
    return run.lines
      .filter((l) => l.tipo === "ARMADO" || l.tipo === "DESARMADO")
      .map((l) => ({
        marcaId: marcaIdDe(l.product),
        formatoId: formatoIdDe(l.product),
        accion: l.tipo as "ARMADO" | "DESARMADO",
        pallets: formatNumeroExacto(l.quantity),
      }));
  }

  // Lo producido de verdad: pallets terminados y cajas sueltas. El armado y el desarmado no suman
  // botellas ni aceite, sólo cambian cómo están apiladas.
  const runTotals = runs.map((run) => {
    let pallets = 0;
    let cajasSueltas = 0;
    let litros = 0;
    let botellas = 0;
    for (const line of run.lines) {
      const qty = line.quantity.toNumber();
      const bpp = line.product.boxesPerPallet ?? 0;
      const upb = line.product.unitsPerBox ?? 0;
      const litrosPorPallet = line.product.recipe.find((r) => r.item.unit === "L")?.quantityPerUnit.toNumber() ?? 0;
      if (line.tipo === "PALLETS") {
        pallets += qty;
        botellas += qty * bpp * upb;
        litros += qty * litrosPorPallet;
      } else if (line.tipo === "CAJAS") {
        cajasSueltas += qty;
        botellas += qty * upb;
        if (bpp) litros += (qty * litrosPorPallet) / bpp;
      }
    }
    return { run, pallets, cajasSueltas, litros, botellas };
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
              maxWidthClass="max-w-2xl"
            >
              <ProductionRunFormFields
                marcas={marcas}
                formatos={formatos}
                tapas={tapas}
                cajas={cajas}
                etiquetas={etiquetas}
                aceites={aceites}
              />
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
        {runTotals.map(({ run, pallets, cajasSueltas, litros, botellas }) => (
          <div key={run.id} className="rounded-xl border border-foreground/10 bg-background shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-foreground/10 bg-foreground/[0.02] px-4 py-3">
              <div className="flex items-center gap-3">
                <p className="font-semibold">{formatFecha(run.date)}</p>
                <span className="text-xs text-foreground/40">
                  {run.lines.length} {run.lines.length === 1 ? "item" : "items"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm whitespace-nowrap">
                <span>
                  <span className="font-semibold">{formatQuantity(pallets)}</span>{" "}
                  <span className="text-foreground/50">pallets</span>
                </span>
                {cajasSueltas > 0 && (
                  <span>
                    <span className="font-semibold">{formatQuantity(cajasSueltas)}</span>{" "}
                    <span className="text-foreground/50">cajas</span>
                  </span>
                )}
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
                      maxWidthClass="max-w-2xl"
                      iconName="edit"
                    >
                      <ProductionRunFormFields
                        marcas={marcas}
                        formatos={formatos}
                        tapas={tapas}
                        cajas={cajas}
                        etiquetas={etiquetas}
                        aceites={aceites}
                        editingRunId={run.id}
                        defaultValues={{ date: toDateInputValue(run.date), notes: run.notes ?? "" }}
                        defaultRows={filasDe(run)}
                        defaultArmados={armadosDe(run)}
                      />
                    </FormModal>
                    <DeleteButton
                      action={deleteProductionRun}
                      hiddenName="runId"
                      hiddenValue={run.id}
                      nombre={`la producción del ${formatFecha(run.date)}`}
                      consecuencia="Revierte el stock de producto e insumos que generó."
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
                    {/* Qué se hizo, con palabras: "+3 pallets" no es lo mismo que "+48 cajas
                        sueltas" ni que "desarmó 1 pallet". */}
                    <span
                      className={
                        qty < 0 || line.tipo === "DESARMADO"
                          ? "font-semibold text-red-600 dark:text-red-400"
                          : line.tipo === "ARMADO"
                            ? "font-semibold text-foreground/70"
                            : "font-semibold text-green-600 dark:text-green-400"
                      }
                    >
                      {line.tipo === "CAJAS"
                        ? `+${formatQuantity(qty)} ${qty === 1 ? "caja suelta" : "cajas sueltas"}`
                        : line.tipo === "ARMADO"
                          ? `armado: ${formatQuantity(qty)} ${qty === 1 ? "pallet" : "pallets"}`
                          : line.tipo === "DESARMADO"
                            ? `desarmado: ${formatQuantity(qty)} ${qty === 1 ? "pallet" : "pallets"}`
                            : `${qty > 0 ? "+" : ""}${formatQuantity(qty)} ${Math.abs(qty) === 1 ? "pallet" : "pallets"}`}
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
