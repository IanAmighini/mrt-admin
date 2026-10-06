import type { Entity } from "@prisma/client";
import { PedidoLinesFields, type FilaDePedido } from "./PedidoLinesFields";
import { SelectBuscable } from "@/components/ui/SelectBuscable";

type MarcaInfo = { id: string; name: string; oilType: string };
type FormatoInfo = { id: string; presentation: string };

export function PedidoFormFields({
  clientes,
  marcas,
  formatos,
  editingPedidoId,
  defaultRows,
  orderNumber,
  defaultValues,
}: {
  clientes: Entity[];
  marcas: MarcaInfo[];
  formatos: FormatoInfo[];
  /** Si viene, el formulario edita este pedido en vez de crear uno nuevo. */
  editingPedidoId?: string;
  /** Al editar: las líneas que ya tiene el pedido. */
  defaultRows?: FilaDePedido[];
  /** Solo para mostrar en modo edición — el número de pedido no se puede cambiar a mano. */
  orderNumber?: string;
  defaultValues?: {
    entityId?: string;
    date?: string;
    comments?: string;
  };
}) {
  return (
    <>
      {editingPedidoId && (
        <p className="text-xs text-foreground/50">
          Al guardar se reemplazan las líneas de este pedido por las que queden acá. Vienen
          cargadas las que ya tenía.
        </p>
      )}
      {editingPedidoId && <input type="hidden" name="pedidoId" value={editingPedidoId} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cliente">
          <SelectBuscable
            name="entityId"
            required
            defaultValue={defaultValues?.entityId ?? ""}
            opciones={clientes.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Escribí el cliente…"
            className={selectClass}
          />
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
          {editingPedidoId ? (
            <p className="px-3 py-2 text-sm text-foreground/60">{orderNumber}</p>
          ) : (
            <p className="px-3 py-2 text-sm text-foreground/40">Se asigna automáticamente</p>
          )}
        </Field>
        <Field label="Comentarios (opcional)">
          <input name="comments" defaultValue={defaultValues?.comments} className={inputClass} />
        </Field>
      </div>
      <PedidoLinesFields marcas={marcas} formatos={formatos} defaultRows={defaultRows} />
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

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const selectClass = inputClass;
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
