import type { Entity, Product } from "@prisma/client";
import { PedidoLinesFields } from "./PedidoLinesFields";

export function PedidoFormFields({
  clientes,
  products,
  editingPedidoId,
  defaultValues,
}: {
  clientes: Entity[];
  products: Product[];
  /** Si viene, el formulario edita este pedido en vez de crear uno nuevo. */
  editingPedidoId?: string;
  defaultValues?: {
    entityId?: string;
    date?: string;
    orderNumber?: string;
    comments?: string;
    lines?: { productId: string; pallets: string }[];
  };
}) {
  return (
    <>
      {editingPedidoId && (
        <p className="text-xs text-foreground/50">
          Al guardar se reemplazan las líneas de este pedido por las que cargues acá.
        </p>
      )}
      {editingPedidoId && <input type="hidden" name="pedidoId" value={editingPedidoId} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cliente">
          <select
            name="entityId"
            required
            defaultValue={defaultValues?.entityId ?? ""}
            className={selectClass}
          >
            <option value="">— Elegir cliente —</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha">
          <input
            type="date"
            name="date"
            required
            defaultValue={defaultValues?.date}
            className={inputClass}
          />
        </Field>
        <Field label="Número de pedido">
          <input
            name="orderNumber"
            required
            defaultValue={defaultValues?.orderNumber}
            className={inputClass}
          />
        </Field>
        <Field label="Comentarios (opcional)">
          <input name="comments" defaultValue={defaultValues?.comments} className={inputClass} />
        </Field>
      </div>
      <PedidoLinesFields products={products.map((p) => ({
        id: p.id,
        name: p.name,
        oilType: p.oilType,
        bottleCapacityMl: p.bottleCapacityMl ? p.bottleCapacityMl.toNumber() : null,
      }))} defaultRows={defaultValues?.lines} />
      <button type="submit" className={submitClass}>
        {editingPedidoId ? "Guardar cambios" : "Crear pedido"}
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

const inputClass = "w-full rounded border border-foreground/20 px-3 py-2 text-sm";
const selectClass = inputClass;
const submitClass =
  "w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover";
