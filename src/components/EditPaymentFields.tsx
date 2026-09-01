import type { Entity, PaymentMethod } from "@prisma/client";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { PaymentDestinoField } from "./PaymentDestinoField";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

const PAYMENT_METHODS: PaymentMethod[] = ["EFECTIVO", "TRANSFERENCIA", "CHEQUE", "ECHEQ", "OTRO"];

export function EditPaymentFields({
  paymentId,
  defaultValues,
  treasuries,
  proveedores,
}: {
  paymentId: string;
  defaultValues: {
    circuit: "BLANCO" | "NEGRO";
    method: PaymentMethod;
    date: string;
    amount: string;
    reference?: string;
    /** Id de tesorería, PROVEEDOR_DIRECTO_VALUE, o "" si no tiene destino asignado. */
    destino?: string;
    proveedorId?: string;
  };
  treasuries: Entity[];
  /** Solo si esta cuenta es de un cliente: lista de proveedores, para "directo a un proveedor". */
  proveedores?: Entity[];
}) {
  const isCobro = proveedores !== undefined;
  return (
    <>
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="isCobro" value={isCobro ? "1" : "0"} />

      <div className="space-y-1">
        <p className="text-sm">Cuenta</p>
        <div className="grid grid-cols-2 gap-2">
          <label className={toggleClass}>
            <input
              type="radio"
              name="circuit"
              value="BLANCO"
              defaultChecked={defaultValues.circuit === "BLANCO"}
              className="sr-only"
            />
            Blanco (con factura)
          </label>
          <label className={toggleClass}>
            <input
              type="radio"
              name="circuit"
              value="NEGRO"
              defaultChecked={defaultValues.circuit === "NEGRO"}
              className="sr-only"
            />
            Negro (sin factura)
          </label>
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-sm">Método de pago</p>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((method) => (
            <label key={method} className={toggleClass}>
              <input
                type="radio"
                name="method"
                value={method}
                defaultChecked={defaultValues.method === method}
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
          <input id="date" type="date" name="date" required defaultValue={defaultValues.date} className={inputClass} />
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
            defaultValue={defaultValues.amount}
            className={inputClass}
          />
        </div>
      </div>

      <PaymentDestinoField
        isCobro={isCobro}
        treasuries={treasuries}
        proveedores={proveedores}
        defaultDestino={defaultValues.destino ?? ""}
        defaultProveedorId={defaultValues.proveedorId}
      />

      <div className="space-y-1">
        <label className="text-sm" htmlFor="reference">
          Descripción
        </label>
        <textarea
          id="reference"
          name="reference"
          rows={2}
          defaultValue={defaultValues.reference}
          className={inputClass}
        />
      </div>

      <p className="text-xs text-foreground/50">
        Si cambiás el monto o la cuenta, se vuelve a imputar por FIFO desde cero.
      </p>

      <button type="submit" className={submitClass}>
        Guardar cambios
      </button>
    </>
  );
}
