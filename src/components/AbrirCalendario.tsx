"use client";

import { useEffect } from "react";

/**
 * Tocar cualquier parte de un campo de fecha abre el calendario, no sólo el ícono chiquito de la
 * punta. Con la fecha de hoy ya puesta, lo que se hace es cambiarla, y apuntarle al ícono —o
 * escribir día, mes y año por partes— era lo incómodo.
 *
 * Un solo listener para toda la app, en vez de tocar cada uno de los formularios.
 */
export function AbrirCalendario() {
  useEffect(() => {
    function alTocar(e: MouseEvent) {
      const campo = e.target;
      if (!(campo instanceof HTMLInputElement) || campo.type !== "date" || campo.disabled || campo.readOnly) return;
      try {
        campo.showPicker();
      } catch {
        // Algún navegador viejo no lo tiene, o no lo deja abrir: ahí queda el comportamiento normal.
      }
    }
    document.addEventListener("click", alTocar);
    return () => document.removeEventListener("click", alTocar);
  }, []);
  return null;
}
