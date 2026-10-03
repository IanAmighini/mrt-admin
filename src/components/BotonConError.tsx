"use client";

import { useActionState } from "react";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";

/**
 * Un botón que dispara una acción —depositar un cheque, reactivar un usuario, pasar un remito a
 * Blanco— y, si la acción falla, dice por qué debajo del botón.
 *
 * Es el hermano chico de `FormConError`, para los que viven sueltos en una fila de una tabla. Un
 * `<form action>` pelado reemplazaba la pantalla entera por "This page couldn't load" ante el primer
 * error, aunque fuera uno esperado como "Este cheque se entregó con un pago".
 */
export function BotonConError({
  action,
  hidden,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Los campos ocultos que la acción necesita. */
  hidden: Record<string, string>;
  className: string;
  children: React.ReactNode;
}) {
  const [error, formAction, pending] = useActionState<string | null, FormData>(async (_prev, formData) => {
    try {
      await action(formData);
      return null;
    } catch (e) {
      if (esSenalDeNavegacion(e)) throw e;
      return userErrorMessage(e);
    }
  }, null);

  return (
    <form action={formAction}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" disabled={pending} className={`${className} disabled:opacity-50`}>
        {children}
      </button>
      {error && <p className="mt-1 max-w-xs text-xs text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}
