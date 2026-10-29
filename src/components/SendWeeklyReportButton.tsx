"use client";

import { userErrorMessage } from "@/lib/user-error";
import { useActionState } from "react";
import { CircleAlert, CircleCheck, Send } from "lucide-react";
import type { SendNowResult } from "@/app/(app)/reportes/actions";

/**
 * Botón de "enviar ahora" con confirmación a la vista. Muestra tanto el éxito como el error: sin
 * eso, apretarlo no da ninguna señal de si el mail salió o no.
 */
export function SendWeeklyReportButton({
  action,
  label = "Enviar reporte ahora",
  campos = {},
}: {
  action: (formData: FormData) => Promise<SendNowResult>;
  label?: string;
  /** Lo que viaja con el pedido: el período del cierre que se está mirando. */
  campos?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<SendNowResult | null, FormData>(async (_prev, formData) => {
    try {
      return await action(formData);
    } catch (e) {
      return { ok: false, mensaje: userErrorMessage(e) };
    }
  }, null);

  return (
    <div>
      <form action={formAction}>
        {Object.entries(campos).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <button
          type="submit"
          disabled={pending}
          className="flex w-fit items-center gap-1.5 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
        >
          <Send size={15} />
          {pending ? "Enviando…" : label}
        </button>
      </form>
      {state && (
        <p
          className={`mt-1 flex max-w-xs items-start gap-1 text-xs ${
            state.ok
              ? "text-green-700 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {state.ok ? (
            <CircleCheck size={13} className="mt-0.5 shrink-0" />
          ) : (
            <CircleAlert size={13} className="mt-0.5 shrink-0" />
          )}
          {state.mensaje}
        </p>
      )}
    </div>
  );
}
