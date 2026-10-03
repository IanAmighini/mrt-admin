"use client";

import { useActionState } from "react";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";
import { buttonClass } from "./ui/Button";

/**
 * Un formulario suelto —de los que viven en la página y no adentro de un diálogo— que muestra el
 * error del servidor arriba del botón en vez de romper la pantalla.
 *
 * Un `<form action={accionDeServidor}>` pelado no atrapa nada: si la acción tira, Next reemplaza
 * la página entera por "This page couldn't load", que no dice qué pasó, pierde lo tipeado y parece
 * que se rompió la app cuando en realidad el dato estaba mal. `FormModal` ya resolvía esto para
 * los formularios en diálogo; esto es lo mismo para los que están al aire.
 *
 * El botón lo pone el componente y no quien lo usa: tiene que saber si la acción está corriendo
 * para deshabilitarlo, y ese estado vive acá. Los campos van como `children` y se siguen
 * renderizando en el servidor.
 */
export function FormConError({
  action,
  children,
  className,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  /** Los campos. Se arman en el servidor y entran tal cual. */
  children: React.ReactNode;
  className?: string;
  submitLabel: string;
  /** Qué dice el botón mientras guarda. Por defecto, el mismo texto con puntos suspensivos. */
  pendingLabel?: string;
}) {
  const [error, formAction, pending] = useActionState<string | null, FormData>(
    async (_prevState, formData) => {
      try {
        await action(formData);
        return null;
      } catch (e) {
        // Un redirect no es un error: si se lo traga el catch, la acción parece fallar y la
        // navegación nunca ocurre.
        if (esSenalDeNavegacion(e)) throw e;
        return userErrorMessage(e);
      }
    },
    null
  );

  return (
    <form action={formAction} className={className}>
      {children}
      {error && (
        // `basis-full`: en un formulario en fila (flex-wrap) el aviso ocupa su propio renglón.
        <p className="w-full basis-full rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primario", "w-fit disabled:opacity-50")}
      >
        {pending ? (pendingLabel ?? `${submitLabel}…`) : submitLabel}
      </button>
    </form>
  );
}
