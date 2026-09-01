import type { Entity, PaymentMethod } from "@prisma/client";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { PaymentDestinoField } from "./PaymentDestinoField";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

const PAYMENT_METHODS: PaymentMethod[] = ["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "ECHEQ", "OTRO"];

export { PROVEEDOR_DIRECTO_VALUE } from "./PaymentDestinoField";

export function PaymentFormFields({
  entities,
  entityNoun,
  fixedEntityId,
  treasuries,
  proveedores,
}: {
  entities?: Entity[];
  entityNoun?: string;
  fixedEntityId?: string;
  /** Las 2 entidades TESORERIA (Banco Galicia, Caja Bufano) — para el selector de destino/origen. */
  treasuries: Entity[];
  /** Solo para cobros de clientes: lista de proveedores, para la opción "directo a un proveedor". */
  proveedores?: Entity[];
}) {
  const isCobro = entityNoun === "Cliente";
  const defaultTreasuryId = treasuries.find((t) => t.name === "Banco Galicia")?.id ?? treasuries[0]?.id ?? "";

  return (
    <>
      <input type="hidden" name="isCobro" value={isCobro ? "1" : "0"} />
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

      <PaymentDestinoField
        isCobro={isCobro}
        treasuries={treasuries}
        proveedores={proveedores}
        defaultDestino={defaultTreasuryId}
      />

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
