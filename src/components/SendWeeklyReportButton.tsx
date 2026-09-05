"use client";

import { userErrorMessage } from "@/lib/user-error";
import { useActionState } from "react";
import { CircleAlert, CircleCheck, Send } from "lucide-react";
import type { SendNowResult } from "@/app/(app)/reportes/actions";

/**
 * Botón de "enviar ahora" con confirmación a la vista. Muestra tanto el éxito como el error: sin
 * eso, apretarlo no da ninguna señal de si el mail salió o no.
 */
export function SendWeeklyReportButton({ action }: { action: () => Promise<SendNowResult> }) {
  const [state, formAction, pending] = useActionState<SendNowResult | null, FormData>(async () => {
    try {
      return await action();
    } catch (e) {
      return { ok: false, mensaje: userErrorMessage(e) };
    }
  }, null);

  return (
    <div>
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="flex w-fit items-center gap-1.5 rounded-lg border border-foreground/20 bg-background px-3 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
        >
          <Send size={15} />
          {pending ? "Enviando…" : "Enviar reporte ahora"}
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
