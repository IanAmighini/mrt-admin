"use client";

import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";
import { useActionState, useEffect, useRef, useState } from "react";
import { KeyRound, Pencil, Plus, X, type LucideIcon } from "lucide-react";
import { buttonClass, type PesoDeBoton } from "./ui/Button";
import { useEnvioUnico } from "./useEnvioUnico";

const TRIGGER_ICONS: Record<string, LucideIcon> = {
  plus: Plus,
  edit: Pencil,
  key: KeyRound,
};

export function FormModal({
  triggerLabel,
  title,
  action,
  children,
  maxWidthClass = "max-w-lg",
  iconName = "plus",
  peso = "primario",
  soloIcono = false,
}: {
  triggerLabel: string;
  title: string;
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  maxWidthClass?: string;
  iconName?: keyof typeof TRIGGER_ICONS;
  /** Cuánto pesa el botón que abre el diálogo. Cuando todos son primarios, el que se usa veinte
   * veces por día se ve igual que el que se usa una vez por mes. */
  peso?: PesoDeBoton;
  /**
   * El botón es sólo el ícono, gris, como el tachito de al lado. Para los "Editar" de cada fila de
   * una lista: eran veinte botones amarillos iguales y no se distinguía la acción principal de la
   * pantalla. El texto queda como `title` y `aria-label`, con el título del diálogo.
   */
  soloIcono?: boolean;
}) {
  const TriggerIcon = TRIGGER_ICONS[iconName];
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Se incrementa cada vez que se ABRE el diálogo — al usarlo como key del <form> se fuerza a
  // remontar los campos, así el próximo "Nuevo X" no arranca con los valores que habían quedado
  // cargados la vez anterior.
  //
  // Antes se incrementaba al cerrarlo, con `onClose`, y no funcionaba: el evento `close` del
  // <dialog> no llega (comprobado con un listener nativo, no es cosa de React), así que el reseteo
  // no ocurría nunca y el formulario conservaba lo tipeado. Al abrir siempre se ejecuta, sin
  // importar cómo se haya cerrado antes — con la X, con Escape o clickeando afuera.
  const [resetKey, setResetKey] = useState(0);
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

  const unaVez = useEnvioUnico(pending);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !error) {
      dialogRef.current?.close();
    }
    wasPending.current = pending;
  }, [pending, error]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setResetKey((k) => k + 1);
          dialogRef.current?.showModal();
        }}
        className={soloIcono ? ICONO : buttonClass(peso, "flex w-fit items-center gap-1.5")}
        {...(soloIcono ? { "aria-label": title, title } : {})}
      >
        <TriggerIcon size={16} />
        {!soloIcono && triggerLabel}
      </button>
      <dialog
        ref={dialogRef}
        className={`fixed inset-0 m-auto w-full ${maxWidthClass} rounded-xl border border-foreground/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50`}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-lg p-1 text-foreground/40 transition-colors hover:bg-foreground/5 hover:text-foreground"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">{error}</p>
          )}
          <form key={resetKey} action={formAction} onSubmit={unaVez}>
            {/* Mientras guarda, todo deshabilitado: el botón de guardar vive en `children`. */}
            <fieldset disabled={pending} className="m-0 min-w-0 space-y-3 border-0 p-0 disabled:opacity-60">
              {children}
            </fieldset>
          </form>
        </div>
      </dialog>
    </>
  );
}

const ICONO =
  "rounded-lg border border-transparent p-2 text-foreground/40 transition-colors hover:border-foreground/15 hover:bg-foreground/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";
