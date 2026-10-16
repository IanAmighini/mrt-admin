import Link from "next/link";
import { formatFecha } from "@/lib/period";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-helpers";
import { getCuadroDeViaje } from "@/lib/entregas";
import { formatMoney } from "@/lib/money";
import { generoDe } from "@/components/ViajeFields";
import { ETIQUETA } from "@/components/Etiquetas";
import { cantidadDeRenglones, DetalleDelViaje } from "@/components/CuadroDeViaje";

/**
 * El cuadro de un viaje: lo que se le cargó, lo que pagó y el saldo que queda, en una sola
 * pantalla. Es el reemplazo del cuadro de la planilla, y por eso mezcla las dos cuentas — un
 * camión lleva remitos en negro y facturas en blanco, y el saldo del viaje es uno solo.
 *
 * Arriba lo que se mira primero —cuánto falta— y abajo el detalle sin tablas, igual que en la
 * planilla de todos juntos: antes era una tabla ancha y en el celular se cortaban los importes.
 */
export default async function ViajePage({
  params,
}: {
  params: Promise<{ entityId: string; entregaId: string }>;
}) {
  const { entregaId } = await params;
  await requireUser();

  const datos = await getCuadroDeViaje(entregaId);
  if (!datos) notFound();

  const { entrega, cuadro } = datos;
  const { total, cobrado, saldo } = cuadro;
  const moneda = entrega.entity.moneda;
  const rotulo = entrega.entity.rotuloSubcuenta ?? "Viaje";
  const esProveedor = entrega.entity.type === "PROVEEDOR";
  const saldadoComo = esProveedor ? "Pagado" : "Cobrado";

  const saldado = saldo.abs().lessThan(0.005);
  const aFavor = saldo.isNegative() && !saldado;
  const avance = total.greaterThan(0) ? Math.min(Math.max(cobrado.div(total).toNumber(), 0), 1) : 0;
  const llevo = cantidadDeRenglones(cuadro.renglones.filter((r) => !r.devolucion));
  const devolvio = cantidadDeRenglones(cuadro.renglones.filter((r) => r.devolucion));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/cuentas-corrientes/${entrega.entity.slug}`} className="text-sm underline underline-offset-2">
          ← {entrega.entity.name}
        </Link>
        <div className="mt-2">
          <h1 className="text-xl font-semibold">
            {entrega.nombre}
            {entrega.destino && <span className="font-normal text-foreground/50"> · {entrega.destino}</span>}
          </h1>
          <p className="text-sm text-foreground/60">
            {formatFecha(entrega.fecha)} · cargado por {entrega.createdBy.name}
          </p>
        </div>
        {entrega.notas && <p className="mt-2 text-sm text-foreground/60">{entrega.notas}</p>}
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <p className="text-sm text-foreground/60">
              {saldado
                ? `${generoDe(rotulo).este[0].toUpperCase()}${generoDe(rotulo).este.slice(1)} ${rotulo.toLowerCase()} está saldad${generoDe(rotulo).articulo === "la" ? "a" : "o"}`
                : aFavor
                  ? esProveedor
                    ? "A favor nuestro"
                    : "A favor del cliente"
                  : esProveedor
                    ? "Falta pagar"
                    : "Falta cobrar"}
            </p>
            <p
              className={`text-3xl font-semibold tabular-nums ${
                saldado || aFavor ? "text-green-700 dark:text-green-400" : ""
              }`}
            >
              {formatMoney(aFavor ? saldo.negated() : saldo, moneda)}
            </p>
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-xs text-foreground/50">Total</p>
              <p className="font-semibold tabular-nums">{formatMoney(total, moneda)}</p>
            </div>
            <div>
              <p className="text-xs text-foreground/50">{saldadoComo}</p>
              <p className="font-semibold tabular-nums text-green-700 dark:text-green-400">{formatMoney(cobrado, moneda)}</p>
            </div>
          </div>
        </div>
        {total.greaterThan(0) && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-green-600/70" style={{ width: `${avance * 100}%` }} />
          </div>
        )}
        {(cuadro.remitos.length > 0 || llevo || devolvio) && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {cuadro.remitos.length > 0 && (
              <span className={ETIQUETA}>
                {cuadro.remitos.length === 1 ? "Remito" : "Remitos"} {cuadro.remitos.join(" · ")}
              </span>
            )}
            {llevo && <span className={ETIQUETA}>Llevó {llevo}</span>}
            {devolvio && (
              <span className="whitespace-nowrap rounded-md bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
                Devolvió {devolvio}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-foreground/10 bg-background pb-1 shadow-sm">
        <DetalleDelViaje
          renglones={cuadro.renglones}
          movimientos={cuadro.movimientos}
          moneda={moneda}
          rotulo={rotulo}
          esProveedor={esProveedor}
        />
      </div>
    </div>
  );
}
