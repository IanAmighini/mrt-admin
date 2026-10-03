/**
 * Cuántos pallets hay que desarmar para entregar unas cajas sueltas, para mostrarlo antes de guardar.
 *
 * Hace la misma cuenta que el servidor (`moverStockDeLinea`): las cajas que pide una línea salen
 * primero de las sueltas que hay de esa caja, y lo que falte, de desarmar pallets del formato de la
 * línea. Varias líneas de la misma caja se van comiendo las sueltas en orden, igual que al guardar.
 *
 * Vive aparte y sin dependencias del servidor porque la usan los formularios mientras se escribe.
 */
export type StockParaPlan = { pallets: number; sueltas: number; cajaId: string | null };

export type LineaParaPlan = { productId: string; cajas: number; boxesPerPallet: number | null };

export function desarmadosPorLinea(
  lineas: LineaParaPlan[],
  stock: Record<string, StockParaPlan>
): { aDesarmar: number; sobran: number }[] {
  const sueltasPorCaja = new Map<string, number>();
  return lineas.map((l) => {
    const s = stock[l.productId];
    if (!l.cajas || !s?.cajaId || !l.boxesPerPallet) return { aDesarmar: 0, sobran: 0 };
    const hay = sueltasPorCaja.get(s.cajaId) ?? Math.max(s.sueltas, 0);
    const faltan = l.cajas - hay;
    const aDesarmar = faltan > 0 ? Math.ceil(faltan / l.boxesPerPallet) : 0;
    const quedan = hay + aDesarmar * l.boxesPerPallet - l.cajas;
    sueltasPorCaja.set(s.cajaId, quedan);
    return { aDesarmar, sobran: quedan };
  });
}
