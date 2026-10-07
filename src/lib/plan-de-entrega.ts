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

export type LineaParaPlan = { productId: string; pallets: number; cajas: number; boxesPerPallet: number | null };

/**
 * `faltanPallets` y `faltanCajas` son lo que la entrega se lleva y todavía no está cargado: no frena
 * nada —la producción del día se carga a la noche—, pero queda en negativo hasta entonces, y el
 * formulario lo avisa.
 */
export function desarmadosPorLinea(
  lineas: LineaParaPlan[],
  stock: Record<string, StockParaPlan>
): { aDesarmar: number; sobran: number; faltanPallets: number; faltanCajas: number }[] {
  const sueltasPorCaja = new Map<string, number>();
  const palletsPorProducto = new Map<string, number>();
  return lineas.map((l) => {
    const s = stock[l.productId];
    if (!s) return { aDesarmar: 0, sobran: 0, faltanPallets: 0, faltanCajas: 0 };
    // Los pallets que se lleva esta línea salen antes que cualquier desarmado, como en el servidor.
    const palletsAntes = palletsPorProducto.get(l.productId) ?? s.pallets;
    const palletsDespues = palletsAntes - (l.pallets || 0);
    const faltanPallets = Math.max(0, -palletsDespues) - Math.max(0, -palletsAntes);
    palletsPorProducto.set(l.productId, palletsDespues);
    if (!l.cajas || !s.cajaId || !l.boxesPerPallet) return { aDesarmar: 0, sobran: 0, faltanPallets, faltanCajas: 0 };

    const hay = sueltasPorCaja.get(s.cajaId) ?? Math.max(s.sueltas, 0);
    const faltan = l.cajas - Math.max(hay, 0);
    const disponibles = Math.max(Math.floor(palletsDespues), 0);
    const aDesarmar = faltan > 0 ? Math.min(Math.ceil(faltan / l.boxesPerPallet), disponibles) : 0;
    palletsPorProducto.set(l.productId, palletsDespues - aDesarmar);
    const quedan = hay + aDesarmar * l.boxesPerPallet - l.cajas;
    sueltasPorCaja.set(s.cajaId, quedan);
    return { aDesarmar, sobran: Math.max(quedan, 0), faltanPallets, faltanCajas: Math.max(0, -quedan) - Math.max(0, -hay) };
  });
}
