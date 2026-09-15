"use client";

import { useState } from "react";
import { formatMoney, parseNumeroSuave, ZERO } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

export type PagoSinOrden = {
  id: string;
  fecha: string;
  metodo: string;
  /** El monto en formato argentino, para sumarlo en vivo. */
  amount: string;
  montoLabel: string;
  comprobante: string | null;
  imputadoA: string | null;
};

/**
 * Agrupa pagos ya cargados en una orden. No carga plata: los pagos existen, ya imputaron contra las
 * facturas y ya tocaron la caja. Una factura pagada con transferencia y echeq son dos pagos y una
 * sola orden.
 */
export function OrdenPagoFields({
  entityId,
  pagos,
}: {
  entityId: string;
  pagos: PagoSinOrden[];
}) {
  const [elegidos, setElegidos] = useState<Record<string, boolean>>({});

  const total = pagos
    .filter((p) => elegidos[p.id])
    .reduce((acc, p) => acc.plus(parseNumeroSuave(p.amount) ?? ZERO), ZERO);
  const cuantos = pagos.filter((p) => elegidos[p.id]).length;

  return (
    <>
      <input type="hidden" name="entityId" value={entityId} />

      {pagos.length === 0 ? (
        <p className="text-sm text-foreground/60">
          No hay pagos de la cuenta Blanco sin orden. Cargá primero el pago —uno por medio— y volvé
          acá para agruparlos.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-sm">
              Pagos que entran en la orden
              <span className="block text-xs text-foreground/50">
                Sólo los de la cuenta Blanco que no están en otra orden.
              </span>
            </p>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-foreground/10 p-2">
              {pagos.map((p) => (
                <label key={p.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(elegidos[p.id])}
                    onChange={(e) => setElegidos((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                    className="mt-1"
                  />
                  {elegidos[p.id] && <input type="hidden" name="paymentId" value={p.id} />}
                  <span className="flex-1">
                    {p.fecha} · {p.metodo} · {p.montoLabel}
                    <span className="block text-xs text-foreground/50">
                      {[p.comprobante && `Comprobante ${p.comprobante}`, p.imputadoA]
                        .filter(Boolean)
                        .join(" · ") || "sin imputar a ningún comprobante"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm" htmlFor="date">
                Fecha de la orden
              </label>
              <input id="date" type="date" name="date" required className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="notes">
                Observaciones (opcional)
              </label>
              <input id="notes" name="notes" className={inputClass} />
            </div>
          </div>

          <div className="flex items-baseline justify-between border-t border-foreground/10 pt-3">
            <span className="text-sm">
              {cuantos === 0 ? "Sin pagos elegidos" : `${cuantos} pago${cuantos === 1 ? "" : "s"}`}
            </span>
            <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
          </div>

          <button type="submit" className={submitClass}>
            Generar orden de pago
          </button>
        </>
      )}
    </>
  );
}
