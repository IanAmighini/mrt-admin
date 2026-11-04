"use client";

import { useState } from "react";
import { formatMoney, formatNumeroEditable, parseNumeroSuave, ZERO } from "@/lib/money";
import { hoyEnInput, parseFecha } from "@/lib/period";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { FINANCIERA_POR_DEFECTO, rendimientoDeFinanciera } from "@/lib/financiera";
import { SelectBuscable } from "@/components/ui/SelectBuscable";
import { FilasDeCheques, filasIniciales, type FilaDeCheque } from "@/components/CambioChequesFields";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-2 py-1 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

const fechaSuave = (raw: string) => {
  try {
    return raw ? parseFecha(raw) : null;
  } catch {
    return null;
  }
};

/**
 * Un cliente le transfiere a la financiera y ella nos da cheques a plazo por más. Se carga lo que
 * transfirió y los cheques; la diferencia —la ganancia— la calcula la app y se muestra antes de
 * guardar, con el % y a cuántos días.
 */
export function ChequesDeFinancieraFields({ clientes }: { clientes: { id: string; name: string }[] }) {
  const [filas, setFilas] = useState<FilaDeCheque[]>(filasIniciales);
  const [transferencia, setTransferencia] = useState("");
  const [fecha, setFecha] = useState(hoyEnInput());

  const transferido = parseNumeroSuave(transferencia) ?? ZERO;
  const { total, ganancia, pct, dias } = rendimientoDeFinanciera({
    fecha: fechaSuave(fecha),
    transferencia: transferido,
    cheques: filas.map((f) => ({ monto: parseNumeroSuave(f.monto) ?? ZERO, fechaCobro: fechaSuave(f.fecha) })),
  });
  const completo = transferido.greaterThan(0) && total.greaterThan(0);

  return (
    <>
      <p className="text-xs text-foreground/50">
        El cliente paga lo que transfirió. Los cheques entran en cartera a <strong>Caja Bufano</strong>, y lo que valen de
        más es un <strong>ingreso financiero</strong>: suma al resultado del mes.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="financiera">
            Financiera
          </label>
          <input id="financiera" name="financiera" required defaultValue={FINANCIERA_POR_DEFECTO} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input
            id="date"
            type="date"
            name="date"
            required
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="entityId">
            Cliente que transfirió
          </label>
          <SelectBuscable
            id="entityId"
            name="entityId"
            required
            opciones={clientes.map((c) => ({ value: c.id, label: c.name }))}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="circuit">
            Cuenta
          </label>
          <select id="circuit" name="circuit" defaultValue="NEGRO" className={inputClass}>
            <option value="BLANCO">{CIRCUIT_LABELS.BLANCO.split(" (")[0]}</option>
            <option value="NEGRO">{CIRCUIT_LABELS.NEGRO.split(" (")[0]}</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="transferencia">
            Transfirió
          </label>
          <input
            id="transferencia"
            name="transferencia"
            required
            inputMode="decimal"
            value={transferencia}
            onChange={(e) => setTransferencia(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <FilasDeCheques filas={filas} setFilas={setFilas} />

      <div className="space-y-1 border-t border-foreground/10 pt-3 text-sm tabular-nums">
        <div className="flex items-baseline justify-between">
          <span>Cheques</span>
          <span>{formatMoney(total)}</span>
        </div>
        <div className="flex items-baseline justify-between text-foreground/60">
          <span>Transfirió el cliente</span>
          <span>− {formatMoney(transferido)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span>
            Ingreso financiero
            {completo && pct && !ganancia.isNegative() && (
              <span className="ml-2 text-xs text-foreground/50">
                {formatNumeroEditable(pct)}% a {dias} {dias === 1 ? "día" : "días"}
              </span>
            )}
          </span>
          <span
            className={`text-lg font-semibold ${completo && ganancia.isNegative() ? "text-red-600 dark:text-red-400" : ""}`}
          >
            {formatMoney(ganancia)}
          </span>
        </div>
        {completo && ganancia.isNegative() && (
          <p className="text-xs text-red-600 dark:text-red-400">Los cheques suman menos que la transferencia: revisá los montos.</p>
        )}
      </div>

      <button type="submit" className={submitClass}>
        Registrar cheques
      </button>
    </>
  );
}
