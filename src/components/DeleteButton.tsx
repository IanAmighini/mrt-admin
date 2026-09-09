"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { esSenalDeNavegacion, userErrorMessage } from "@/lib/user-error";

/**
 * Botón de eliminar con confirmación propia.
 *
 * El diálogo es del mismo material que el resto de la app y no el `window.confirm` del navegador,
 * que en el teléfono aparece con el dominio adelante y no deja destacar la consecuencia aparte de
 * la pregunta. Además así el error del servidor se muestra dentro del mismo diálogo, sin que la
 * fila se llene de texto rojo.
 */
export function DeleteButton({
  action,
  hiddenName,
  hiddenValue,
  nombre,
  consecuencia,
  irreversible = true,
  label = "Eliminar",
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  hiddenName: string;
  hiddenValue: string;
  /** Qué se elimina, para nombrarlo en la pregunta: `la compra #33503`, `la marca "Bonanza"`. */
  nombre: string;
  /** Qué más pasa además de borrarlo — el stock que se revierte, los remitos que se liberan. */
  consecuencia?: string;
  /** En false para los borrados que se pueden deshacer, como desactivar un usuario. */
  irreversible?: boolean;
  /** Por si en el contexto conviene otra palabra que "Eliminar". */
  label?: string;
  /** Inputs ocultos extra, cuando la acción necesita más de un campo. */
  children?: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // El mensaje se guarda aparte del estado de la acción para poder limpiarlo al reabrir: sin eso,
  // el error de un intento anterior sigue ahí la próxima vez, aunque el motivo ya no exista.
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [error, formAction, pending] = useActionState<string | null, FormData>(
    async (_prevState, formData) => {
      try {
        await action(formData);
        setMensaje(null);
        return null;
      } catch (e) {
        // Un redirect no es un error: si se lo traga el catch, la acción parece fallar y la
        // navegación nunca ocurre.
        if (esSenalDeNavegacion(e)) throw e;
        const texto = userErrorMessage(e);
        setMensaje(texto);
        return texto;
      }
    },
    null
  );

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
          setMensaje(null);
          dialogRef.current?.showModal();
        }}
        className={botonRojo}
      >
        <Trash2 size={16} />
        {label}
      </button>
      <dialog
        ref={dialogRef}
        className="fixed inset-0 m-auto w-full max-w-md rounded-xl border border-foreground/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <form action={formAction} className="space-y-4 p-6">
          <input type="hidden" name={hiddenName} value={hiddenValue} />
          {children}
          <h2 className="text-base font-semibold text-balance">
            ¿Estás seguro que querés eliminar {nombre}?
          </h2>
          {(consecuencia || irreversible) && (
            <p className="text-sm text-foreground/60">
              {consecuencia}
              {consecuencia && irreversible ? " " : ""}
              {irreversible && "Esta acción no se puede deshacer."}
            </p>
          )}
          {mensaje && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {mensaje}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:bg-foreground/5"
            >
              Cancelar
            </button>
            <button type="submit" disabled={pending} className={`${botonRojo} disabled:opacity-50`}>
              <Trash2 size={16} />
              {pending ? "Eliminando…" : label}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** Mismo cuerpo que el botón de editar (el trigger de FormModal), en rojo. */
const botonRojo =
  "flex w-fit items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700";
