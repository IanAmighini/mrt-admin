import type { Prisma, Preforma } from "@prisma/client";
import type { DeudaPreforma } from "@/lib/preformas";
import { formatQuantity } from "@/lib/money";
import { toDateInputValue } from "@/lib/period";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import {
  createEntregaPreforma,
  deleteEntregaPreforma,
} from "@/app/(app)/cuentas-corrientes/[entityId]/preformas-actions";

type EntregaInfo = {
  id: string;
  date: Date;
  quantity: Prisma.Decimal;
  comprobante: string | null;
  preforma: { name: string };
};

/**
 * La segunda cuenta con el proveedor que fía la preforma: la que se lleva en unidades y no en pesos.
 * Lo recibido no se carga acá — sale solo de los remitos, así que lo único que se da de alta son
 * las entregas.
 */
export function PreformasPanel({
  entityId,
  deudas,
  preformas,
  entregas,
  canEdit,
}: {
  entityId: string;
  deudas: DeudaPreforma[];
  preformas: Preforma[];
  entregas: EntregaInfo[];
  canEdit: boolean;
}) {
  const hayDeuda = deudas.length > 0;

  return (
    <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Preformas</h2>
          <p className="text-xs text-foreground/50">
            Se le deben las preformas de cada envase que sopló, hasta que se le entregan.
          </p>
        </div>
        {canEdit && preformas.length > 0 && (
          <FormModal triggerLabel="Registrar entrega" title="Entrega de preformas" action={createEntregaPreforma}>
            <input type="hidden" name="entityId" value={entityId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm" htmlFor="preforma-date">
                  Fecha
                </label>
                <input
                  id="preforma-date"
                  type="date"
                  name="date"
                  required
                  defaultValue={toDateInputValue(new Date())}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="preforma-tipo">
                  Tipo de preforma
                </label>
                <select id="preforma-tipo" name="preformaId" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    — Elegir —
                  </option>
                  {preformas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="preforma-cantidad">
                  Cantidad entregada
                </label>
                <input
                  id="preforma-cantidad"
                  name="quantity"
                  required
                  inputMode="decimal"
                  placeholder="100.000"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="preforma-comprobante">
                  Comprobante (opcional)
                </label>
                <input id="preforma-comprobante" name="comprobante" className={inputClass} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="preforma-notas">
                Notas
              </label>
              <textarea id="preforma-notas" name="notes" rows={2} className={inputClass} />
            </div>
            <button
              type="submit"
              className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              Registrar
            </button>
          </FormModal>
        )}
      </div>

      {hayDeuda ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4 font-medium">Preforma</th>
                <th className="py-2 pr-4 text-right font-medium">Recibidas</th>
                <th className="py-2 pr-4 text-right font-medium">Entregadas</th>
                <th className="py-2 text-right font-medium">Se le debe</th>
              </tr>
            </thead>
            <tbody>
              {deudas.map((d) => {
                const saldo = Number(d.saldo.toString());
                return (
                  <tr key={d.preformaId} className="border-b border-foreground/5 last:border-0">
                    <td className="py-2 pr-4 font-medium">{d.nombre}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-foreground/60">
                      {formatQuantity(d.recibidas)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-foreground/60">
                      {formatQuantity(d.entregadas)}
                    </td>
                    <td
                      className={`py-2 text-right font-semibold tabular-nums ${
                        saldo > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
                      }`}
                    >
                      {formatQuantity(d.saldo)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-4 text-center text-sm text-foreground/40">
          Todavía no hay envases recibidos ni preformas entregadas.
        </p>
      )}

      {entregas.length > 0 && (
        <div className="space-y-2 border-t border-foreground/10 pt-3">
          <p className="text-xs font-medium text-foreground/60">Últimas entregas</p>
          {entregas.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate">
                  {formatQuantity(e.quantity)} de {e.preforma.name}
                </p>
                <p className="text-xs text-foreground/50">
                  {e.date.toLocaleDateString("es-AR")}
                  {e.comprobante ? ` · ${e.comprobante}` : ""}
                </p>
              </div>
              {canEdit && (
                <DeleteButton
                  action={deleteEntregaPreforma}
                  hiddenName="entregaId"
                  hiddenValue={e.id}
                  confirmMessage="¿Borrar esta entrega? Vuelve a subir lo que se le debe."
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
