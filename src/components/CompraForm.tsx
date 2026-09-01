import type { Item } from "@prisma/client";
import { CompraLinesFields } from "./CompraLinesFields";

export function CompraFormFields({
  entityId,
  items,
  editingDocumentId,
  defaultValues,
}: {
  entityId: string;
  items: Item[];
  editingDocumentId?: string;
  defaultValues?: { number?: string; date?: string; dueDate?: string; currency?: string; exchangeRate?: string };
}) {
  return (
    <>
      <p className="text-xs text-foreground/50">
        {editingDocumentId
          ? "Al guardar se reemplazan las líneas de esta compra por las que cargues acá, y el stock se recalcula."
          : "Al cargar la compra se suma el stock de cada insumo automáticamente y se imputa a la cuenta corriente del proveedor — una misma compra puede tener líneas facturadas (van a Blanco) y sin facturar (van a Negro)."}
      </p>
      <input type="hidden" name="entityId" value={entityId} />
      {editingDocumentId && <input type="hidden" name="documentId" value={editingDocumentId} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Número">
          <input name="number" required defaultValue={defaultValues?.number} className={inputClass} />
        </Field>
        <Field label="Fecha">
          <input type="date" name="date" required defaultValue={defaultValues?.date} className={inputClass} />
        </Field>
        <Field label="Vencimiento (opcional)">
          <input type="date" name="dueDate" defaultValue={defaultValues?.dueDate} className={inputClass} />
        </Field>
        <Field label="Moneda">
          <select name="currency" defaultValue={defaultValues?.currency ?? "ARS"} className={selectClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Cotización (si es USD)">
          <input name="exchangeRate" defaultValue={defaultValues?.exchangeRate} className={inputClass} />
        </Field>
      </div>
      <CompraLinesFields items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))} />
      <button type="submit" className={submitClass}>
        {editingDocumentId ? "Guardar cambios" : "Crear compra"}
      </button>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const selectClass = inputClass;
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
