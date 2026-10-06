"use client";

import { useEffect, useRef } from "react";

/**
 * Que un formulario no se mande dos veces.
 *
 * Con `useActionState`, un segundo click mientras se guarda no se descarta: queda en cola y se
 * ejecuta cuando termina el primero, así que el remito o el pago se cargaba dos veces. Deshabilitar
 * el botón no alcanza —un doble click llega antes de que React vuelva a dibujarlo—, así que se corta
 * en el `submit`, que es sincrónico: mientras haya un envío en curso, el siguiente no sale.
 *
 * Devuelve el `onSubmit` para el `<form>`.
 */
export function useEnvioUnico(pending: boolean) {
  const enviando = useRef(false);
  useEffect(() => {
    if (!pending) enviando.current = false;
  }, [pending]);
  return (e: React.FormEvent<HTMLFormElement>) => {
    if (enviando.current) {
      e.preventDefault();
      return;
    }
    enviando.current = true;
  };
}
