"use client";

import { useState } from "react";
import { DEFAULT_IVA_RATE, formatMoney, formatNumeroEditable, parseNumeroSuave, ZERO } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const smallInputClass = "w-28 rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-xs";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

/** Lo mínimo que el formulario necesita de cada comprobante a facturar. Se pasa ya serializado
 * porque este componente corre en el navegador y un Decimal no cruza esa frontera. */
export type ComprobanteFacturable = {
  id: string;
  number: string;
  date: string;
  /** Lo que falta facturar, con IVA incluido: es lo que se imputa contra la factura. */
  pending: string;
  /** El neto del comprobante, para precargar el neto de la factura. */
  neto: string;
};

export function FacturaFormFields({
  accountId,
  isWithholdingAgent,
  comprobantes,
  /** "Remito" del lado de ventas, "Compra" del lado de proveedores. */
  sustantivo = "Remito",
}: {
  accountId: string;
  isWithholdingAgent: boolean;
  comprobantes: ComprobanteFacturable[];
  sustantivo?: string;
}) {
  // Arranca sin nada tildado: facturar de más por no mirar es peor que tener que tildar.
  const [elegidos, setElegidos] = useState<Record<string, boolean>>({});
  const [montos, setMontos] = useState<Record<string, string>>(() =>
    Object.fromEntries(comprobantes.map((c) => [c.id, c.pending]))
  );
  const [neto, setNeto] = useState("");
  const [netoTocado, setNetoTocado] = useState(false);
  const [ivaRate, setIvaRate] = useState(String(DEFAULT_IVA_RATE));
  const [percepcion, setPercepcion] = useState("");
  const [retencion, setRetencion] = useState("");

  const netoDeLoElegido = comprobantes
    .filter((c) => elegidos[c.id])
    .reduce((acc, c) => acc.plus(parseNumeroSuave(c.neto) ?? ZERO), ZERO);

  const toggle = (id: string, valor: boolean) => {
    const siguientes = { ...elegidos, [id]: valor };
    setElegidos(siguientes);
    // Mientras no lo hayan escrito a mano, el neto sigue a lo tildado: así el número de la factura
    // y el de los comprobantes no se separan por una distracción.
    if (!netoTocado) {
      const suma = comprobantes
        .filter((c) => siguientes[c.id])
        .reduce((acc, c) => acc.plus(parseNumeroSuave(c.neto) ?? ZERO), ZERO);
      setNeto(suma.isZero() ? "" : formatNumeroEditable(suma));
    }
  };

  const netoNum = parseNumeroSuave(neto) ?? ZERO;
  const iva = netoNum.times(parseNumeroSuave(ivaRate) ?? ZERO).dividedBy(100);
  const total = netoNum
    .plus(iva)
    .plus(parseNumeroSuave(percepcion) ?? ZERO)
    .minus(parseNumeroSuave(retencion) ?? ZERO);
  const imputado = comprobantes
    .filter((c) => elegidos[c.id])
    .reduce((acc, c) => acc.plus(parseNumeroSuave(montos[c.id] ?? "") ?? ZERO), ZERO);

  return (
    <>
      <input type="hidden" name="accountId" value={accountId} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="number">
            Número
          </label>
          <input id="number" name="number" required placeholder="A-0001-00001234" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="dueDate">
            Vencimiento (opcional)
          </label>
          <input id="dueDate" type="date" name="dueDate" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="currency">
            Moneda
          </label>
          <select id="currency" name="currency" defaultValue="ARS" className={inputClass}>
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="exchangeRate">
            Cotización (si es USD)
          </label>
          <input id="exchangeRate" name="exchangeRate" inputMode="decimal" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="netAmount">
            Neto
          </label>
          <input
            id="netAmount"
            name="netAmount"
            required
            inputMode="decimal"
            value={neto}
            onChange={(e) => {
              setNeto(e.target.value);
              setNetoTocado(true);
            }}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="ivaRate">
            Alícuota IVA %
          </label>
          <input
            id="ivaRate"
            name="ivaRate"
            inputMode="decimal"
            value={ivaRate}
            onChange={(e) => setIvaRate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="perceptionAmount">
            Percepción RG 5329
          </label>
          <input
            id="perceptionAmount"
            name="perceptionAmount"
            inputMode="decimal"
            placeholder="0,00"
            value={percepcion}
            onChange={(e) => setPercepcion(e.target.value)}
            className={inputClass}
          />
        </div>
        {isWithholdingAgent && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="retentionAmount">
              Retención
            </label>
            <input
              id="retentionAmount"
              name="retentionAmount"
              inputMode="decimal"
              value={retencion}
              onChange={(e) => setRetencion(e.target.value)}
              className={inputClass}
            />
          </div>
        )}
      </div>

      {comprobantes.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm">
            {sustantivo}s que cubre esta factura{" "}
            <span className="text-foreground/50">
              — tildá los que entran; el monto imputado se puede bajar para cubrir sólo una parte
            </span>
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-foreground/10 p-2">
            {comprobantes.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(elegidos[c.id])}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                />
                {elegidos[c.id] && <input type="hidden" name="remitoId" value={c.id} />}
                <span className="flex-1">
                  {sustantivo} #{c.number} — {c.date} — pendiente {formatMoney(c.pending)}
                </span>
                {elegidos[c.id] && (
                  <input
                    name="remitoAmount"
                    inputMode="decimal"
                    value={montos[c.id] ?? ""}
                    onChange={(e) => setMontos((p) => ({ ...p, [c.id]: e.target.value }))}
                    className={smallInputClass}
                  />
                )}
              </label>
            ))}
          </div>
          {!netoDeLoElegido.isZero() && netoTocado && !netoNum.equals(netoDeLoElegido) && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              El neto no coincide con el de lo tildado ({formatMoney(netoDeLoElegido)}). Puede estar
              bien si la factura trae algo más, pero conviene mirarlo.
            </p>
          )}
        </div>
      )}

      <div className="space-y-1 border-t border-foreground/10 pt-3 text-sm">
        <div className="flex items-baseline justify-between">
          <span>IVA</span>
          <span className="tabular-nums text-foreground/70">{formatMoney(iva)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="font-medium">Total</span>
          <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
        </div>
        {!imputado.isZero() && (
          <div className="flex items-baseline justify-between text-xs text-foreground/50">
            <span>Imputado a {sustantivo.toLowerCase()}s</span>
            <span className="tabular-nums">{formatMoney(imputado)}</span>
          </div>
        )}
      </div>

      <button type="submit" className={submitClass}>
        Crear factura
      </button>
    </>
  );
}
