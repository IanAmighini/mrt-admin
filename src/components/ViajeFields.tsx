export type ViajeOption = { id: string; nombre: string; destino: string | null };
export type DestinatarioOption = { id: string; nombre: string; taxId: string | null };

/**
 * Concordancia de género para el rótulo que elige cada ficha. "Viaje" es masculino y "Subcuenta"
 * femenino, y un botón que dice "Nuevo subcuenta" se lee como un error de la app. La regla del
 * -a alcanza para las palabras que se usan acá; si alguna vez no alcanza, se agrega al helper.
 */
export function generoDe(rotulo: string) {
  const femenino = rotulo.trim().toLowerCase().endsWith("a");
  return {
    nuevo: femenino ? "Nueva" : "Nuevo",
    este: femenino ? "esta" : "este",
    articulo: femenino ? "la" : "el",
  };
}

export function etiquetaDeViaje(viaje: ViajeOption) {
  return viaje.destino ? `${viaje.nombre} · ${viaje.destino}` : viaje.nombre;
}

/**
 * El viaje al que pertenece el comprobante o el pago, y a nombre de quién sale el papel.
 *
 * **No se muestra nada si el cliente no tiene ninguno de los dos cargados**, que es el caso de
 * casi todos: la pantalla queda exactamente como estaba y esto aparece sólo donde se usa.
 */
export function ViajeFields({
  viajes = [],
  destinatarios = [],
  defaultViajeId,
  defaultDestinatarioId,
  /** En un pago no hay a quién emitirle el papel: sólo se elige contra qué parte se imputa. */
  mostrarDestinatario = true,
  ayudaViaje,
  rotulo = "Viaje",
}: {
  viajes?: ViajeOption[];
  destinatarios?: DestinatarioOption[];
  defaultViajeId?: string | null;
  defaultDestinatarioId?: string | null;
  mostrarDestinatario?: boolean;
  ayudaViaje?: string;
  /** Cómo llama esta ficha a sus partes: "Viaje", "Subcuenta". */
  rotulo?: string;
}) {
  const hayViajes = viajes.length > 0;
  const hayDestinatarios = mostrarDestinatario && destinatarios.length > 0;
  if (!hayViajes && !hayDestinatarios) return null;

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
      {hayViajes && (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="viaje-entregaId">
            {rotulo}
          </label>
          <select
            id="viaje-entregaId"
            name="entregaId"
            defaultValue={defaultViajeId ?? ""}
            className={selectClass}
          >
            <option value="">— Sin {rotulo.toLowerCase()} —</option>
            {viajes.map((v) => (
              <option key={v.id} value={v.id}>
                {etiquetaDeViaje(v)}
              </option>
            ))}
          </select>
        </div>
      )}
      {hayDestinatarios && (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="viaje-destinatarioId">
            A nombre de
          </label>
          <select
            id="viaje-destinatarioId"
            name="destinatarioId"
            defaultValue={defaultDestinatarioId ?? ""}
            className={selectClass}
          >
            <option value="">— El titular de la cuenta —</option>
            {destinatarios.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
                {d.taxId ? ` · ${d.taxId}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="col-span-2 text-xs text-foreground/50">
        {ayudaViaje ??
          `${rotulo} separa esta parte de la cuenta, con su propio saldo, y hace que los pagos que le pongas se imputen ahí adentro. El destinatario es a nombre de quién sale el papel: la deuda sigue siendo de esta cuenta, pero la factura y el libro de IVA salen con su CUIT.`}
      </p>
    </div>
  );
}

const selectClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
