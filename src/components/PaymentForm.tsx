import { createPayment } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { getAccountDocuments, getDocumentPending } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { DOCUMENT_TYPE_LABELS } from "@/lib/labels";

export function PaymentForm({
  accountId,
  pendingDocuments,
}: {
  accountId: string;
  pendingDocuments: Awaited<ReturnType<typeof getAccountDocuments>>;
}) {
  const pending = pendingDocuments
    .map((doc) => ({ doc, amount: getDocumentPending(doc) }))
    .filter((d) => d.amount.greaterThan(0));

  return (
    <form action={createPayment} className="space-y-3 rounded-lg border border-black/10 p-4">
      <h3 className="text-sm font-semibold">Nuevo pago / cobro</h3>
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha">
          <input type="date" name="date" required className={inputClass} />
        </Field>
        <Field label="Monto">
          <input name="amount" required inputMode="decimal" className={inputClass} />
        </Field>
        <Field label="Moneda">
          <select name="currency" defaultValue="ARS" className={selectClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </Field>
        <Field label="Forma de pago">
          <select name="method" defaultValue="EFECTIVO" className={selectClass}>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="CHEQUE">Cheque</option>
            <option value="OTRO">Otro</option>
          </select>
        </Field>
      </div>
      <Field label="N° de cheque / comprobante (si aplica)">
        <input name="reference" className={inputClass} />
      </Field>
      <fieldset className="space-y-1">
        <legend className="text-sm mb-1">Imputación</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="allocationMode" value="fifo" defaultChecked />
          Automática (FIFO — al comprobante pendiente más antiguo)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="allocationMode" value="manual" />
          Manual — elegir comprobante(s) y monto
        </label>
      </fieldset>
      {pending.length > 0 && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {pending.map(({ doc, amount }) => (
            <div key={doc.id} className="flex items-center gap-2 text-sm">
              <input type="hidden" name="manualDocumentId" value={doc.id} />
              <span className="flex-1">
                {DOCUMENT_TYPE_LABELS[doc.type]} #{doc.number} — pendiente{" "}
                {formatMoney(amount, doc.currency)}
              </span>
              <input
                name="manualAmount"
                placeholder="0.00"
                inputMode="decimal"
                className="w-24 rounded border border-black/20 px-2 py-1 text-xs"
              />
            </div>
          ))}
        </div>
      )}
      <button type="submit" className={submitClass}>
        Registrar pago
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
