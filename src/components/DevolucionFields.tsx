import type { Currency, Product } from "@prisma/client";
import { hoyEnInput } from "@/lib/period";
import { RemitoLinesFields } from "./RemitoLinesFields";

type PriceMap = Record<"BLANCO" | "NEGRO", Record<string, { amount: number; currency: string }>>;

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

/**
 * Lo que un cliente devuelve. Las mismas líneas que una entrega —producto, pallets, cajas, precio
 * por botella y cuenta—, pero al revés: la mercadería vuelve al stock y se le hace una nota de
 * crédito por lo que vale. El precio arranca en el de su lista, que es por lo que se le cobró.
 */
export function DevolucionFields({
  entityId,
  products,
  priceMapByCircuit,
  moneda = "ARS",
}: {
  entityId: string;
  products: Product[];
  priceMapByCircuit: PriceMap;
  moneda?: Currency;
}) {
  return (
    <>
      <input type="hidden" name="entityId" value={entityId} />
      <p className="text-xs text-foreground/50">
        Lo devuelto vuelve al stock —en pallets o en cajas sueltas— y se le hace al cliente una nota de
        crédito por lo que vale. Si hay líneas en Blanco y en Negro, sale una nota por cada cuenta.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="dev-number">
            Número de la nota de crédito
          </label>
          <input id="dev-number" name="number" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="dev-date">
            Fecha
          </label>
          <input id="dev-date" type="date" name="date" required defaultValue={hoyEnInput()} className={inputClass} />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="dev-reason">
          Por qué se devolvió
        </label>
        <input
          id="dev-reason"
          name="reason"
          required
          placeholder="Botellas golpeadas, error de pedido, vencimiento…"
          className={inputClass}
        />
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
        moneda={moneda}
      />
      <button
        type="submit"
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        Registrar devolución
      </button>
    </>
  );
}
