import type { Entity, PaymentMethod } from "@prisma/client";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";

const inputClass = "w-full rounded border border-foreground/20 px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

const PAYMENT_METHODS: PaymentMethod[] = ["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "ECHEQ", "OTRO"];

export function PaymentFormFields({
  entities,
  entityNoun,
  fixedEntityId,
}: {
  entities?: Entity[];
  entityNoun?: string;
  fixedEntityId?: string;
}) {
  return (
    <>
      {fixedEntityId ? (
        <input type="hidden" name="entityId" value={fixedEntityId} />
      ) : (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="entityId">
            {entityNoun} *
          </label>
          <select id="entityId" name="entityId" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Seleccionar {entityNoun?.toLowerCase()}...
            </option>
            {entities?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-sm">Cuenta</p>
        <div className="grid grid-cols-2 gap-2">
          <label className={toggleClass}>
            <input type="radio" name="circuit" value="BLANCO" defaultChecked className="sr-only" />
            Blanco (con factura)
          </label>
          <label className={toggleClass}>
            <input type="radio" name="circuit" value="NEGRO" className="sr-only" />
            Negro (sin factura)
          </label>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-sm">Método de pago</p>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((method, i) => (
            <label key={method} className={toggleClass}>
              <input
                type="radio"
                name="method"
                value={method}
                defaultChecked={i === 0}
                className="sr-only"
              />
              {PAYMENT_METHOD_LABELS[method]}
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="amount">
            Monto *
          </label>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            placeholder="0.00"
            className={inputClass}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="reference">
          Descripción
        </label>
        <textarea
          id="reference"
          name="reference"
          rows={2}
          placeholder="Observaciones del pago..."
          className={inputClass}
        />
      </div>

      <button type="submit" className={submitClass}>
        Registrar pago
      </button>
    </>
  );
}
