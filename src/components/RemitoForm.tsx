import type { Product } from "@prisma/client";
import { createRemito } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import type { PedidoPendiente } from "@/lib/pedidos";
import { formatProductBrandLabel } from "@/lib/product-label";
import { formatQuantity } from "@/lib/money";
import { PEDIDO_STATUS_LABELS } from "@/lib/labels";
import { RemitoLinesFields } from "./RemitoLinesFields";

type PriceMap = Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>>;

export function RemitoFormFields({
  entityId,
  products,
  priceMapByCircuit,
  editingDocumentId,
  defaultValues,
  pedidosPendientes,
}: {
  entityId: string;
  products: Product[];
  priceMapByCircuit: PriceMap;
  /** Si viene, el formulario edita este remito en vez de crear uno nuevo — las líneas se cargan
   * de nuevo desde cero (no se prellenan), pero el encabezado sí. */
  editingDocumentId?: string;
  defaultValues?: { number?: string; date?: string; dueDate?: string; currency?: string; exchangeRate?: string };
  /** Pedidos pendientes (no entregados) de este cliente — al tildarlos se marcan como
   * "Entregado" automáticamente al crear el remito. No se muestra al editar un remito existente. */
  pedidosPendientes?: PedidoPendiente[];
}) {
  return (
    <>
      <p className="text-xs text-black/50">
        {editingDocumentId
          ? "Al guardar se reemplazan las líneas de este remito por las que cargues acá."
          : "Un mismo remito puede tener líneas facturadas (van a Blanco) y sin facturar (van a Negro) — se cargan las dos cuentas del cliente automáticamente según lo que elijas por línea."}
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
      <RemitoLinesFields
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          oilType: p.oilType,
          bottleCapacityMl: p.bottleCapacityMl ? p.bottleCapacityMl.toNumber() : null,
          boxesPerPallet: p.boxesPerPallet,
          unitsPerBox: p.unitsPerBox,
        }))}
        priceMapByCircuit={priceMapByCircuit}
      />
      {!editingDocumentId && pedidosPendientes && pedidosPendientes.length > 0 && (
        <div className="space-y-2 rounded border border-black/10 p-3">
          <p className="text-sm font-medium">¿Este remito entrega alguno de estos pedidos?</p>
          <p className="text-xs text-black/50">
            Los que tildes se marcan como &quot;Entregado&quot; automáticamente al crear el remito.
          </p>
          <div className="space-y-1">
            {pedidosPendientes.map((pedido) => (
              <label key={pedido.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="pedidoId" value={pedido.id} className="mt-1" />
                <span>
                  #{pedido.orderNumber} — {PEDIDO_STATUS_LABELS[pedido.status]} —{" "}
                  {pedido.lines
                    .map(
                      (l) => `${formatProductBrandLabel(l.product)} (${formatQuantity(l.pallets, "pallets")})`
                    )
                    .join(", ")}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      <button type="submit" className={submitClass}>
        {editingDocumentId ? "Guardar cambios" : "Crear remito"}
      </button>
    </>
  );
}

export function RemitoForm({
  entityId,
  products,
  priceMapByCircuit,
  pedidosPendientes,
}: {
  entityId: string;
  products: Product[];
  priceMapByCircuit: PriceMap;
  pedidosPendientes?: PedidoPendiente[];
}) {
  return (
    <form action={createRemito} className="space-y-4 rounded-lg border border-black/10 p-4">
      <h2 className="text-sm font-semibold">Nuevo remito</h2>
      <RemitoFormFields
        entityId={entityId}
        products={products}
        priceMapByCircuit={priceMapByCircuit}
        pedidosPendientes={pedidosPendientes}
      />
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
