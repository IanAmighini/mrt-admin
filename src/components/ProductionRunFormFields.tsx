import { ProductionLinesFields } from "@/app/(app)/produccion/ProductionLinesFields";

type ProductInfo = { id: string; name: string; oilType: string; presentation: string };

export function ProductionRunFormFields({
  products,
  editingRunId,
  defaultValues,
}: {
  products: ProductInfo[];
  /** Si viene, el formulario edita esta carga en vez de crear una nueva — los ítems se cargan
   * de nuevo desde cero (no se prellenan), pero la fecha y las notas sí. */
  editingRunId?: string;
  defaultValues?: { date?: string; notes?: string };
}) {
  return (
    <>
      {editingRunId && (
        <p className="text-xs text-foreground/50">
          Al guardar se reemplazan los ítems de esta carga por los que cargues acá.
        </p>
      )}
      {editingRunId && <input type="hidden" name="runId" value={editingRunId} />}
      <div className="space-y-1">
        <label className="text-sm" htmlFor="date">
          Fecha
        </label>
        <input
          id="date"
          type="date"
          name="date"
          required
          defaultValue={defaultValues?.date}
          className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
        />
      </div>
      <ProductionLinesFields products={products} />
      <div className="space-y-1">
        <label className="text-sm" htmlFor="notes">
          Notas
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={defaultValues?.notes}
          placeholder="Observaciones…"
          className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        {editingRunId ? "Guardar cambios" : "Registrar"}
      </button>
    </>
  );
}
