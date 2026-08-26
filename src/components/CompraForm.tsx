import type { Item } from "@prisma/client";
import { createCompra } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { CompraLinesFields } from "./CompraLinesFields";

export function CompraForm({ entityId, items }: { entityId: string; items: Item[] }) {
  return (
    <form action={createCompra} className="space-y-4 rounded-lg border border-black/10 p-4">
      <h2 className="text-sm font-semibold">Nueva compra de insumos</h2>
      <p className="text-xs text-black/50">
        Al cargar la compra se suma el stock de cada insumo automáticamente y se imputa a la
        cuenta corriente del proveedor — una misma compra puede tener líneas facturadas (van a
        Blanco) y sin facturar (van a Negro).
      </p>
      <input type="hidden" name="entityId" value={entityId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Número">
          <input name="number" required className={inputClass} />
        </Field>
        <Field label="Fecha">
          <input type="date" name="date" required className={inputClass} />
        </Field>
        <Field label="Vencimiento (opcional)">
          <input type="date" name="dueDate" className={inputClass} />
        </Field>
        <Field label="Moneda">
          <select name="currency" defaultValue="ARS" className={selectClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Cotización (si es USD)">
          <input name="exchangeRate" className={inputClass} />
        </Field>
      </div>
      <CompraLinesFields items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))} />
      <button type="submit" className={submitClass}>
        Crear compra
      </button>
    </form>
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

const inputClass = "w-full rounded border border-black/20 px-3 py-2 text-sm";
const selectClass = inputClass;
const submitClass =
  "w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover";
