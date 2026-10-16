"use client";

import { useRef } from "react";
import { LogOut } from "lucide-react";

/**
 * El botón de salir, con una pregunta antes. Está al lado del buscador y un clic de más cerraba
 * la sesión de golpe: después había que volver a poner email y contraseña en medio de una carga.
 *
 * Mismo diálogo que el de eliminar (no el `confirm` del navegador), y el mismo gesto: gris en
 * reposo, rojo al pasarle el mouse.
 */
export function CerrarSesion({ action }: { action: () => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      {/* Sólo el ícono: el encabezado ya está apretado en el celular. El nombre accesible lo dan
          title y aria-label, que si no el botón queda sin etiqueta. */}
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        title="Cerrar sesión"
        aria-label="Cerrar sesión"
        className="flex items-center rounded-lg border border-transparent px-3 py-2 text-sm text-foreground/70 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/30 dark:hover:border-red-900/50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
      >
        <LogOut size={16} />
      </button>
      <dialog
        ref={dialogRef}
        className="fixed inset-0 m-auto w-[calc(100%-1.5rem)] max-w-sm whitespace-normal rounded-xl border border-foreground/10 bg-background p-0 text-left text-base font-normal text-foreground shadow-xl backdrop:bg-black/50"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <form action={action} className="space-y-4 p-6">
          <h2 className="text-base font-semibold">¿Querés cerrar la sesión?</h2>
          <p className="text-sm text-foreground/60">Para volver a entrar vas a tener que poner tu email y tu contraseña.</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => dialogRef.current?.close()}
              className="rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:bg-foreground/5"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex w-fit items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700"
            >
              <LogOut size={16} />
              Cerrar sesión
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
