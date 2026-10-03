import type { Circuit, PaymentMethod } from "@prisma/client";

/**
 * Las reglas de qué se puede hacer en cada cuenta, en un módulo sin "use client" para que las usen
 * igual el formulario (que esconde lo que no aplica) y la server action (que es la que de verdad
 * lo impide: el formulario se puede saltear).
 */

/**
 * La caja de efectivo, reconocida por el nombre — igual que en /tesoreria. Las tesorerías son dos y
 * fijas (Banco Galicia, Caja Bufano), así que lo que no es caja es el banco.
 */
export function esCaja(nombreTesoreria: string) {
  return nombreTesoreria.toLowerCase().includes("caja");
}

/**
 * En qué fila de la base vive la cuenta única de cada tesorería.
 *
 * **No es un circuito: una caja no es ni Blanco ni Negro.** Se puede pagar en Blanco desde Caja
 * Bufano y en Negro desde el Galicia; el circuito del pago dice contra qué cuenta del proveedor o del
 * cliente se imputa, y la caja es una sola. Pero el modelo guarda los movimientos en una `Account`,
 * y las cuentas tienen circuito, así que cada caja tiene su plata en una sola de sus dos: el banco
 * en la "BLANCO" y las cajas en la "NEGRO", que es donde ya estaba todo cuando se unificó. La otra
 * queda vacía y no se usa. Nada que se muestre puede leer este valor como Blanco o Negro.
 *
 * Antes la plata caía en la que coincidía con el pago, y un pago en Blanco hecho en efectivo dejaba
 * "Caja Bufano Blanco" en negativo con la plata del otro lado.
 */
export function circuitoDeTesoreria(nombreTesoreria: string): Circuit {
  return esCaja(nombreTesoreria) ? "NEGRO" : "BLANCO";
}

const METODOS: PaymentMethod[] = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "CHEQUE",
  "ECHEQ",
  "RETENCION",
  "OTRO",
];

/**
 * Por qué este método no va en esta cuenta, o null si va. Devuelve el texto en vez de tirar para
 * poder usarse también en el navegador; quien tiene que frenar la carga es la action.
 */
export function motivoMetodoInvalido(circuit: Circuit, method: PaymentMethod): string | null {
  if (circuit !== "NEGRO") return null;
  if (method === "ECHEQ") {
    return "Un echeq es bancario y queda registrado: no puede ir en la cuenta en negro. Cargalo como cheque, efectivo o transferencia.";
  }
  if (method === "RETENCION") {
    return "Una retención la practica el cliente sobre una factura, así que no existe en la cuenta en negro.";
  }
  return null;
}

export function metodoValidoEn(circuit: Circuit, method: PaymentMethod) {
  return motivoMetodoInvalido(circuit, method) === null;
}

/** Los métodos que se ofrecen para esta cuenta. `conRetencion` es del lado del cobro nomás. */
export function metodosDePago(circuit: Circuit, opciones?: { conRetencion?: boolean }) {
  const conRetencion = opciones?.conRetencion ?? true;
  return METODOS.filter(
    (m) => (conRetencion || m !== "RETENCION") && metodoValidoEn(circuit, m)
  );
}
