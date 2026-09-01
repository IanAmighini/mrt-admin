/** Valor del campo "destino" que indica que un cobro fue directo a un proveedor (en vez de a una
 * tesorería). Vive en un módulo sin "use client" a propósito: si se declarara en un componente
 * cliente, Next.js reemplaza sus exports por referencias de cliente al importarlos desde código
 * de servidor, y la comparación `destino === PROVEEDOR_DIRECTO_VALUE` en las server actions
 * siempre daría false. */
export const PROVEEDOR_DIRECTO_VALUE = "PROVEEDOR_DIRECTO";
