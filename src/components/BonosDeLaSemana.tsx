"use client";

import { startTransition, useActionState, useState } from "react";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";
import { elegirBonosDe } from "@/app/(app)/sueldos/actions";
import { controlClass } from "./ui/Field";

/**
 * Si la semana paga bonos y de qué mes: un casillero y, tildado, los meses que faltan pagar. Se
 * guarda al tocarlo, sin botón. Al tildar arranca por el mes más viejo, que es el que se debe.
 */
export function BonosDeLaSemana({
  planillaId,
  mes,
  meses,
}: {
  planillaId: string;
  /** El mes que ya paga esta semana, si paga alguno. */
  mes: string | null;
  /** Los meses que se pueden elegir, del más viejo al más nuevo, con su nombre. */
  meses: { mes: string; nombre: string }[];
}) {
  const [paga, setPaga] = useState(Boolean(mes));
  const [error, guardar, pending] = useActionState<string | null, string>(async (_prev, elegido) => {
    const fd = new FormData();
    fd.set("planillaId", planillaId);
    fd.set("mes", elegido);
    try {
      await elegirBonosDe(fd);
      return null;
    } catch (e) {
      if (esSenalDeNavegacion(e)) throw e;
      setPaga(Boolean(mes));
      return userErrorMessage(e);
    }
  }, null);
  const enviar = (elegido: string) => startTransition(() => guardar(elegido));

  const sinMeses = meses.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label className={`flex items-center gap-2 text-sm font-medium ${sinMeses && !paga ? "text-foreground/50" : ""}`}>
        <input
          type="checkbox"
          checked={paga}
          disabled={pending || (sinMeses && !paga)}
          onChange={(e) => {
            setPaga(e.target.checked);
            enviar(e.target.checked ? meses[0].mes : "");
          }}
          className="size-4 accent-primary"
        />
        Esta semana se pagan bonos
      </label>
      {paga && (
        <select
          key={mes ?? ""}
          defaultValue={mes ?? meses[0]?.mes}
          disabled={pending}
          aria-label="Mes de los bonos"
          onChange={(e) => enviar(e.target.value)}
          className={controlClass({ denso: true, extra: "w-auto disabled:opacity-50" })}
        >
          {meses.map((m) => (
            <option key={m.mes} value={m.mes}>
              Bonos de {m.nombre}
            </option>
          ))}
        </select>
      )}
      {sinMeses && !paga && <span className="text-xs text-foreground/50">No hay meses pendientes.</span>}
      {error && <p className="w-full basis-full text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
