import type { Circuit, Currency, Item, Prisma } from "@prisma/client";
import { formatNumeroExacto } from "@/lib/money";
import { NuevaCompraFields, type FilaDeCompra } from "./NuevaCompraForm";
import type { ImpuestosValores } from "./ImpuestosFields";

/**
 * Editar una compra: el mismo formulario que el alta, abierto con lo que ya tiene.
 *
 * Había uno aparte para editar, más viejo, que se fue quedando atrás —no mostraba el precio en pesos
 * que sale de la cotización, ni sabía del aceite por kilo ni de las cuentas en dólares—. Dos
 * formularios para lo mismo terminan diciendo cosas distintas sobre la misma compra.
 */
export function CompraFormFields({
  entidad,
  items,
  editingDocumentId,
  defaultValues,
  impuestos,
  factura,
  defaultRows,
}: {
  entidad: { id: string; name: string; moneda: Currency };
  items: Item[];
  editingDocumentId?: string;
  defaultValues?: { number?: string; date?: string; dueDate?: string; exchangeRate?: string };
  /** Los tributos ya cargados, al editar: alícuota, percepciones y retención. */
  impuestos?: ImpuestosValores;
  /** La factura que la compra ya trae, al editar. */
  factura?: { number: string; date: string };
  /** Las líneas que la compra ya tiene, al editar. */
  defaultRows?: FilaDeCompra[];
}) {
  return (
    <>
      <p className="text-xs text-foreground/50">
        Al guardar se reemplazan las líneas de esta compra por las que queden acá, y el stock se
        recalcula. Vienen cargadas las que ya tenía.
      </p>
      <NuevaCompraFields
        proveedores={[entidad]}
        fixedEntity={entidad}
        items={items.map((i) => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          category: i.category,
          unitsPerPallet: i.unitsPerPallet,
          precioSopladoUsd: i.precioSopladoUsd ? i.precioSopladoUsd.toString() : null,
        }))}
        editingDocumentId={editingDocumentId}
        defaultValues={defaultValues}
        defaultRows={defaultRows}
        impuestosDefaults={impuestos}
        factura={factura}
        textoBoton="Guardar cambios"
      />
    </>
  );
}

/** Una línea guardada, en la forma en que la abre el formulario. */
export function filaDeCompra(
  l: {
    itemId: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    unitPriceUsd: Prisma.Decimal | null;
    kilos: Prisma.Decimal | null;
    precioTonelada: Prisma.Decimal | null;
  },
  circuit: Circuit
): FilaDeCompra {
  return {
    itemId: l.itemId,
    quantity: formatNumeroExacto(l.quantity),
    unitPrice: formatNumeroExacto(l.unitPrice),
    unitPriceUsd: formatNumeroExacto(l.unitPriceUsd),
    kilos: formatNumeroExacto(l.kilos),
    precioTonelada: formatNumeroExacto(l.precioTonelada),
    circuit,
  };
}
