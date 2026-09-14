import { toDateInputValue } from "@/lib/period";

/**
 * La factura que una compra ya trae vinculada, en el formato que espera el formulario. Si no tiene,
 * devuelve undefined y el tilde arranca apagado.
 */
export function facturaDeCompra(doc: {
  remitoLinks: { factura: { number: string; date: Date } }[];
}): { number: string; date: string } | undefined {
  const factura = doc.remitoLinks[0]?.factura;
  return factura ? { number: factura.number, date: toDateInputValue(factura.date) } : undefined;
}
