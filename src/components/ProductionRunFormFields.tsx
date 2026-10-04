import { ProductionLinesFields, type FilaInicial } from "@/app/(app)/produccion/ProductionLinesFields";
import { ArmadoLinesFields, type FilaDeArmado } from "@/app/(app)/produccion/ArmadoLinesFields";

type MarcaInfo = { id: string; name: string; oilType: string };
type FormatoInfo = { id: string; presentation: string };
type ItemInfo = { id: string; name: string };

export function ProductionRunFormFields({
  marcas,
  formatos,
  tapas,
  cajas,
  etiquetas,
  aceites,
  editingRunId,
  defaultValues,
  defaultRows,
  defaultArmados,
}: {
  marcas: MarcaInfo[];
  formatos: FormatoInfo[];
  tapas: ItemInfo[];
  cajas: ItemInfo[];
  etiquetas: ItemInfo[];
  aceites: ItemInfo[];
  /** Si viene, el formulario edita esta carga en vez de crear una nueva. */
  editingRunId?: string;
  defaultValues?: { date?: string; notes?: string };
  /** Al editar: los ítems que ya tiene la carga, para no tener que volver a tipearlos. */
  defaultRows?: FilaInicial[];
  /** Al editar: los pallets armados o desarmados de la carga. */
  defaultArmados?: FilaDeArmado[];
}) {
  return (
    <>
      {editingRunId && (
        <p className="text-xs text-foreground/50">
          Al guardar se reemplazan los ítems de esta carga por los que queden acá. Vienen cargados
          los que ya tenía: corregí lo que haga falta.
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
      <ProductionLinesFields
        marcas={marcas}
        formatos={formatos}
        tapas={tapas}
        cajas={cajas}
        etiquetas={etiquetas}
        aceites={aceites}
        defaultRows={defaultRows}
      />
      <ArmadoLinesFields marcas={marcas} formatos={formatos} defaultRows={defaultArmados} />
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
