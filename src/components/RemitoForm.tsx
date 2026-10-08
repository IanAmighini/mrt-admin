import type { Circuit, Currency, Prisma, Product } from "@prisma/client";
import { formatNumeroExacto } from "@/lib/money";
import type { PedidoPendiente } from "@/lib/pedidos";
import { RemitoLinesFields } from "./RemitoLinesFields";
import { PedidoLinkChecklist } from "./PedidoLinkChecklist";
import { ViajeFields, type DestinatarioOption, type ViajeOption } from "./ViajeFields";
import { hoyEnInput } from "@/lib/period";

type PriceMap = Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>>;

export function RemitoFormFields({
  entityId,
  products,
  priceMapByCircuit,
  editingDocumentId,
  defaultValues,
  defaultLines,
  pedidosPendientes,
  viajes,
  destinatarios,
  rotuloSubcuenta,
  moneda = "ARS",
}: {
  entityId: string;
  /** La moneda de la cuenta del cliente. En una en dólares, el precio ya es en dólares. */
  moneda?: Currency;
  products: Product[];
  priceMapByCircuit: PriceMap;
  /** Si viene, el formulario edita este remito en vez de crear uno nuevo — el encabezado y las
   * líneas se prellenan con `defaultValues`/`defaultLines`. */
  editingDocumentId?: string;
  defaultValues?: {
    number?: string;
    date?: string;
    dueDate?: string;
    currency?: string;
    exchangeRate?: string;
    reason?: string;
    entregaId?: string | null;
    destinatarioId?: string | null;
  };
  defaultLines?: { productId: string; quantity: string; cajas?: string; pricePerBottle: string; circuit: "BLANCO" | "NEGRO" }[];
  /** Pedidos pendientes (no entregados) de este cliente — al tildarlos se marcan como
   * "Entregado" automáticamente al crear el remito. No se muestra al editar un remito existente. */
  pedidosPendientes?: PedidoPendiente[];
  /** Los viajes y los destinatarios de este cliente. Vacíos en quien no los usa: ahí los
   * selectores no se muestran y el formulario queda como estaba. */
  viajes?: ViajeOption[];
  destinatarios?: DestinatarioOption[];
  rotuloSubcuenta?: string;
}) {
  return (
    <>
      <p className="text-xs text-foreground/50">
        {editingDocumentId
          ? "Al guardar se reemplazan las líneas de este remito por las que cargues acá."
          : "Un mismo remito puede tener líneas facturadas (van a la Cuenta 1) y sin facturar (van a la Cuenta 2) — se cargan las dos cuentas del cliente automáticamente según lo que elijas por línea."}
      </p>
      <input type="hidden" name="entityId" value={entityId} />
      {editingDocumentId && <input type="hidden" name="documentId" value={editingDocumentId} />}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Número">
          <input name="number" required defaultValue={defaultValues?.number} className={inputClass} />
        </Field>
        <Field label="Fecha">
          <input type="date" name="date" required defaultValue={defaultValues?.date ?? hoyEnInput()} className={inputClass} />
        </Field>
        <Field label="Vencimiento (opcional)">
          <input type="date" name="dueDate" defaultValue={defaultValues?.dueDate} className={inputClass} />
        </Field>
      </div>
      <ViajeFields
        viajes={viajes}
        destinatarios={destinatarios}
        rotulo={rotuloSubcuenta}
        defaultViajeId={defaultValues?.entregaId}
        defaultDestinatarioId={defaultValues?.destinatarioId}
      />
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
        defaultRows={defaultLines}
        moneda={moneda}
        // En una cuenta en dólares los precios guardados son dólares; con la cotización precargada se
        // leerían como pesos, así que se abre sin ella.
        defaultCotizacion={moneda === "USD" ? undefined : defaultValues?.exchangeRate}
      />
      {!editingDocumentId && <PedidoLinkChecklist pedidosPendientes={pedidosPendientes ?? []} />}
      <Field label="Notas (opcional)">
        <textarea name="reason" rows={2} defaultValue={defaultValues?.reason} className={inputClass} />
      </Field>
      <button type="submit" className={submitClass}>
        {editingDocumentId ? "Guardar cambios" : "Crear remito"}
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
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

/**
 * Una línea guardada, en la forma en que la abre el formulario.
 *
 * Si se pactó en dólares se abre con ese precio, que es el que se escribió y el que se controla; si
 * no, con el del pallet vuelto a pasar a botella.
 */
export function lineaDeRemito(
  l: {
    productId: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    precioBotellaUsd: Prisma.Decimal | null;
    pallets?: number | null;
    cajas?: number | null;
    product: { boxesPerPallet: number | null; unitsPerBox: number | null };
  },
  circuit: Circuit
) {
  const bpp = l.product.boxesPerPallet ?? 0;
  const perPallet = bpp * (l.product.unitsPerBox ?? 0);
  const enPesos = perPallet > 0 ? l.unitPrice.dividedBy(perPallet).toDecimalPlaces(4) : l.unitPrice;
  // Las líneas de antes de las cajas sueltas guardaban pallets con decimales (2,5): se abren como
  // pallets enteros más las cajas que eran esa fracción.
  const enteros = l.pallets ?? Math.floor(l.quantity.toNumber() + 1e-9);
  const cajas = l.cajas ?? (bpp ? Math.round((l.quantity.toNumber() - enteros) * bpp) : 0);
  return {
    productId: l.productId,
    quantity: String(enteros),
    cajas: String(cajas),
    pricePerBottle: formatNumeroExacto(l.precioBotellaUsd ?? enPesos),
    circuit,
  };
}
