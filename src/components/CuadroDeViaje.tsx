import type { MovimientoDeEntrega, RenglonDeViaje } from "@/lib/entregas";
import { formatMoney, formatQuantity, sumDecimals } from "@/lib/money";
import { formatFecha } from "@/lib/period";
import { formatProductBrandLabel } from "@/lib/product-label";
import { DOCUMENT_TYPE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { ETIQUETA } from "@/components/Etiquetas";
import { generoDe } from "@/components/ViajeFields";

/**
 * "28 pallets + 58 cajas". Lo devuelto se cuenta aparte: restado daba "1 pallet + -69 cajas",
 * que no se entendía.
 */
export function cantidadDeRenglones(renglones: RenglonDeViaje[]) {
  const pallets = renglones.reduce((a, r) => a + r.pallets, 0);
  const cajas = renglones.reduce((a, r) => a + r.cajas, 0);
  return [
    pallets ? `${formatQuantity(pallets)} ${pallets === 1 ? "pallet" : "pallets"}` : null,
    cajas ? `${formatQuantity(cajas)} ${cajas === 1 ? "caja" : "cajas"}` : null,
  ]
    .filter(Boolean)
    .join(" + ");
}

/** Una nota de crédito con mercadería, que es como la llaman: el motivo lo deja dicho al crearla. */
const esDevolucion = (doc: { type: string; reason: string | null }) =>
  doc.type === "NOTA_CREDITO" && Boolean(doc.reason?.startsWith("Devolución"));

const titulo = "px-4 pt-3 text-xs font-medium uppercase tracking-wide text-foreground/40";

/**
 * El cuadro de un viaje sin tablas: a un lado lo que llevó, renglón por renglón, y al otro su
 * cuenta —lo cargado, lo cobrado y el saldo corrido—. Lo usan la página del viaje y la de todos
 * juntos, que antes eran tablas anchas donde los importes se cortaban.
 */
export function DetalleDelViaje({
  renglones,
  movimientos,
  moneda,
  rotulo,
  esProveedor = false,
}: {
  renglones: RenglonDeViaje[];
  movimientos: MovimientoDeEntrega[];
  moneda: "ARS" | "USD";
  rotulo: string;
  /** A un proveedor se le paga: sus entradas son pagos, no cobros. */
  esProveedor?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 lg:divide-x lg:divide-foreground/10">
      {renglones.length > 0 && (
        <div className="min-w-0">
          <p className={titulo}>Lo que llevó</p>
          <div className="divide-y divide-foreground/10">
            {renglones.map((r) => (
              <div
                key={r.id}
                className={`flex items-start justify-between gap-3 px-4 py-2.5 text-sm ${r.devolucion ? "text-red-700 dark:text-red-400" : ""}`}
              >
                <div className="min-w-0">
                  <p>
                    {formatProductBrandLabel(r.marca)} {r.formato}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={ETIQUETA}>
                      {r.devolucion ? "Devolución" : "Remito"} #{r.remito}
                    </span>
                    <span className={ETIQUETA}>
                      {[
                        r.pallets ? `${formatQuantity(r.pallets)} ${r.pallets === 1 ? "pallet" : "pallets"}` : null,
                        r.cajas ? `${formatQuantity(r.cajas)} cj` : null,
                        r.botellas ? `${formatQuantity(r.botellas)} bot` : null,
                      ]
                        .filter(Boolean)
                        .join(" + ")}
                      {" · "}
                      {formatQuantity(r.unidades)} u.
                    </span>
                    {r.precioUnitario && <span className={ETIQUETA}>{formatMoney(r.precioUnitario, moneda)}/u.</span>}
                    <span className={ETIQUETA}>
                      {formatFecha(r.fecha)}
                      {r.vencimiento ? ` · vence ${formatFecha(r.vencimiento)}` : ""}
                    </span>
                    {r.circuito === "BLANCO" && <span className={ETIQUETA}>Cuenta 1</span>}
                  </div>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">{formatMoney(r.importe, moneda)}</p>
              </div>
            ))}
            <div className="flex justify-between px-4 py-2.5 text-sm font-semibold">
              <span>Total {rotulo.toLowerCase()}</span>
              <span className="tabular-nums">{formatMoney(sumDecimals(renglones.map((r) => r.importe)), moneda)}</span>
            </div>
          </div>
        </div>
      )}

      <div className={`min-w-0 ${renglones.length > 0 ? "border-t border-foreground/10 lg:border-t-0" : "lg:col-span-2"}`}>
        <p className={titulo}>Cuenta {generoDe(rotulo).articulo === "la" ? "de la" : "del"} {rotulo.toLowerCase()}</p>
        <div className="divide-y divide-foreground/10">
          {movimientos.map((m) => {
            const doc = m.documento;
            const devolucion = doc ? esDevolucion(doc) : false;
            const detalle = doc
              ? devolucion
                ? `Devolución #${doc.number}`
                : doc.type === "AJUSTE" && doc.number.startsWith("SALDO-INICIAL")
                  ? "Saldo inicial"
                  : doc.type === "REMITO"
                    ? `Remito #${doc.number}`
                    : `${DOCUMENT_TYPE_LABELS[doc.type]} #${doc.number}`
              : `${esProveedor ? "Pago" : "Cobro"}${m.pago ? ` · ${PAYMENT_METHOD_LABELS[m.pago.method]}` : ""}`;
            // El motivo de una nota ("descuento 5%") o la referencia de un cobro dicen de qué es.
            const nota = doc
              ? devolucion
                ? null
                : doc.type !== "REMITO" && !doc.number.startsWith("SALDO-INICIAL")
                  ? doc.reason
                  : null
              : m.detalle || null;
            return (
              <div key={`${m.tipo}-${m.id}`} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p>
                    {detalle}
                    {doc?.destinatario && <span className="text-foreground/50"> — {doc.destinatario.nombre}</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={ETIQUETA}>{formatFecha(m.fecha)}</span>
                    {/* Un vencimiento igual a la fecha (el saldo inicial) no dice nada. */}
                    {doc?.dueDate && !m.monto.isNegative() && formatFecha(doc.dueDate) !== formatFecha(doc.date) && (
                      <span className={ETIQUETA}>vence {formatFecha(doc.dueDate)}</span>
                    )}
                    {nota && <span className={`${ETIQUETA} max-w-full truncate`}>{nota}</span>}
                    {m.circuito === "BLANCO" && <span className={ETIQUETA}>Cuenta 1</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`tabular-nums ${m.monto.isNegative() ? "text-green-700 dark:text-green-400" : ""}`}>
                    {formatMoney(m.monto, moneda)}
                  </p>
                  <p className="text-xs tabular-nums text-foreground/50">saldo {formatMoney(m.saldo, moneda)}</p>
                </div>
              </div>
            );
          })}
          {movimientos.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-foreground/40">
              Todavía no hay nada acá. Los comprobantes y los pagos se asignan desde su propio formulario, eligiendo «
              {rotulo}».
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
