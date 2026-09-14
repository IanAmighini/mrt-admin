"use client";

import { useEffect, useState } from "react";
import {
  ALICUOTAS_IVA,
  CAMPO_OTRO_TRIBUTO_DESC,
  OTROS_TRIBUTOS,
  filasDesdeValores,
  computeGastoTotals,
} from "@/lib/impuestos";
import { formatMoney, formatNumeroEditable, parseNumeroSuave, ZERO } from "@/lib/money";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-sm";

export type ImpuestosValores = Record<string, string>;

export const impuestosIniciales = (defaults?: ImpuestosValores): ImpuestosValores => ({ ...defaults });

/**
 * El desglose impositivo de un comprobante, con las mismas columnas que la planilla de IVA: el neto
 * abierto por alícuota, el no gravado, y cada percepción con su jurisdicción.
 *
 * Cuando el neto viene de las líneas de una compra (`netoDeLineas`), el 21% arranca con ese total
 * puesto —que es el caso normal— y sólo hay que tocarlo si la factura trae dos alícuotas. El aviso
 * de abajo compara el reparto contra las líneas, porque el servidor lo rechaza si no cierra.
 */
export function ImpuestosFields({
  defaults,
  onChange,
  netoDeLineas,
  titulo = "Desglose de la factura",
  aclaracion = "El neto sale de las líneas. Casi siempre va entero al 21%; repartilo sólo si la factura trae más de una alícuota.",
}: {
  defaults?: ImpuestosValores;
  onChange?: (valores: ImpuestosValores) => void;
  /** El neto que tienen que sumar las alícuotas más el no gravado. */
  netoDeLineas?: number;
  titulo?: string;
  aclaracion?: string;
}) {
  const [valores, setValores] = useState<ImpuestosValores>(() => impuestosIniciales(defaults));

  // El bloque se monta y desmonta según haya o no líneas en Blanco, y al volver arranca de cero.
  // Sin este aviso el formulario de arriba seguiría mostrando los tributos de la vuelta anterior.
  useEffect(() => {
    onChange?.(valores);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (name: string, value: string) =>
    setValores((previos) => {
      const siguiente = { ...previos, [name]: value };
      onChange?.(siguiente);
      return siguiente;
    });

  const filas = filasDesdeValores(valores);
  const totals = computeGastoTotals(filas, parseNumeroSuave(valores.retentionAmount ?? "") ?? ZERO);
  const hayReparto = filas.some((f) => f.kind === "IVA" || f.kind === "NO_GRAVADO");
  // Sin reparto el servidor manda todo al 21%, así que no hay nada que cuadrar todavía.
  const descuadre =
    netoDeLineas !== undefined && hayReparto ? totals.netAmount.toNumber() - netoDeLineas : 0;

  return (
    <div className="space-y-2 rounded-lg border border-foreground/10 p-3">
      <p className="text-sm font-medium">{titulo}</p>
      <p className="text-xs text-foreground/50">{aclaracion}</p>

      <div className="space-y-1">
        {ALICUOTAS_IVA.map((alicuota) => {
          const campo = `ivaBase_${alicuota}`;
          const base = parseNumeroSuave(valores[campo] ?? "") ?? ZERO;
          const iva = base.times(parseNumeroSuave(alicuota)!).dividedBy(100);
          return (
            <div key={alicuota} className="grid grid-cols-[6rem_1fr_7rem] items-center gap-2">
              <span className="text-sm text-foreground/70">N.G. {alicuota}%</span>
              <input
                name={campo}
                inputMode="decimal"
                value={valores[campo] ?? ""}
                onChange={(e) => set(campo, e.target.value)}
                placeholder={
                  alicuota === "21" && netoDeLineas !== undefined
                    ? formatNumeroEditable(netoDeLineas)
                    : "Neto gravado"
                }
                className={inputClass}
              />
              <span className="text-right text-sm tabular-nums text-foreground/60">
                {base.isZero() ? "—" : formatMoney(iva)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {OTROS_TRIBUTOS.map((tributo) => (
          <div key={tributo.name} className="space-y-1">
            <label className="text-xs text-foreground/70" htmlFor={tributo.name}>
              {tributo.label}
            </label>
            <input
              id={tributo.name}
              name={tributo.name}
              inputMode="decimal"
              value={valores[tributo.name] ?? ""}
              onChange={(e) => set(tributo.name, e.target.value)}
              className={inputClass}
            />
          </div>
        ))}
        <div className="space-y-1">
          <label className="text-xs text-foreground/70" htmlFor="retentionAmount">
            Retención
          </label>
          <input
            id="retentionAmount"
            name="retentionAmount"
            inputMode="decimal"
            value={valores.retentionAmount ?? ""}
            onChange={(e) => set("retentionAmount", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* El comodín sólo pide su nombre cuando tiene monto: si no, es una pregunta sin sentido. */}
      {(parseNumeroSuave(valores.otroTributo ?? "") ?? ZERO).isZero() ? null : (
        <div className="space-y-1">
          <label className="text-xs text-foreground/70" htmlFor={CAMPO_OTRO_TRIBUTO_DESC}>
            ¿Qué es ese otro tributo?
          </label>
          <input
            id={CAMPO_OTRO_TRIBUTO_DESC}
            name={CAMPO_OTRO_TRIBUTO_DESC}
            required
            value={valores[CAMPO_OTRO_TRIBUTO_DESC] ?? ""}
            onChange={(e) => set(CAMPO_OTRO_TRIBUTO_DESC, e.target.value)}
            placeholder="Percepción IIBB Córdoba"
            className={inputClass}
          />
        </div>
      )}

      {Math.abs(descuadre) > 0.009 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          El reparto suma {formatMoney(totals.netAmount)} y las líneas suman{" "}
          {formatMoney(netoDeLineas!)} — {descuadre > 0 ? "sobran" : "faltan"}{" "}
          {formatMoney(Math.abs(descuadre))}.
        </p>
      )}
    </div>
  );
}
