import Link from "next/link";
import { ChevronRight, Truck } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { formatMoney, sumDecimals } from "@/lib/money";
import type { EntregaConSaldo } from "@/lib/entregas";
import { generoDe, type DestinatarioOption } from "./ViajeFields";
import { FormModal } from "./Modal";
import { DeleteButton } from "./DeleteButton";
import {
  actualizarDestinatario,
  actualizarEntrega,
  borrarDestinatario,
  borrarEntrega,
  crearDestinatario,
  crearEntrega,
} from "@/app/(app)/cuentas-corrientes/[entityId]/entregas-actions";
import { formatFecha, hoyEnInput, toDateInputValue } from "@/lib/period";

/**
 * Los viajes de un cliente y la gente a cuyo nombre salen los papeles. Va arriba en la ficha, abajo
 * del saldo: en estos clientes lo primero que se quiere saber es cuánto debe cada parte.
 *
 * Se muestra sólo en la ficha de un cliente que ya los usa, o detrás del botón para empezar a
 * usarlos: para los que entregan de a un remito no aporta nada y sería una sección vacía más.
 */
export function ViajesPanel({
  entityId,
  entitySlug,
  entityName,
  moneda,
  viajes,
  destinatarios,
  canEdit,
  rotulo = "Viaje",
  sinAsignar,
  mostrarDestinatarios = true,
  esProveedor = false,
}: {
  entityId: string;
  entitySlug: string;
  entityName: string;
  moneda: "ARS" | "USD";
  viajes: EntregaConSaldo[];
  destinatarios: DestinatarioOption[];
  canEdit: boolean;
  /** Cómo llama esta ficha a sus partes: "Viaje", "Subcuenta". */
  rotulo?: string;
  /** Lo que queda de la cuenta fuera de estas partes. Se muestra para que los números cierren:
   * sin esto, la suma de las partes no da el saldo de la ficha y no hay forma de saber por qué. */
  sinAsignar: { circuito: "BLANCO" | "NEGRO"; monto: Prisma.Decimal }[];
  /** El destinatario sólo tiene sentido donde el papel sale a nombre de un tercero. */
  mostrarDestinatarios?: boolean;
  /** A un proveedor se le paga, no se le cobra: cambia cómo se nombra lo que ya se saldó. */
  esProveedor?: boolean;
}) {
  const plural = `${rotulo}s`;
  const genero = generoDe(rotulo);
  const conSaldo = viajes.filter((v) => !v.saldo.abs().lessThan(0.005));
  const saldados = viajes.length - conSaldo.length;
  const fuera = sinAsignar.filter((s) => !s.monto.abs().lessThan(0.005));
  const montoFuera = sumDecimals(fuera.map((s) => s.monto));
  const todos = genero.articulo === "la" ? "todas" : "todos";
  const saldadoComo = esProveedor ? "Pagado" : "Cobrado";

  // Lo que sigue debiendo cada parte se ve apenas se abre la ficha, una tarjeta por parte; las que
  // ya quedaron en cero no le importan a nadie en el día a día y van plegadas abajo, junto con lo
  // que se usa para editarlas.
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Truck size={16} className="text-foreground/60" />
            {plural} con saldo
            <span className="font-normal text-foreground/50">({conSaldo.length})</span>
          </h2>
          {viajes.length > 0 && (
            <Link
              href={`/cuentas-corrientes/${entitySlug}/viajes`}
              className="text-xs text-foreground/60 underline underline-offset-2 hover:text-foreground"
            >
              Ver {todos} {genero.articulo === "la" ? "juntas" : "juntos"}
            </Link>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <FormModal
              triggerLabel={`${genero.nuevo} ${rotulo.toLowerCase()}`}
              title={`${genero.nuevo} ${rotulo.toLowerCase()} — ${entityName}`}
              action={crearEntrega}
            >
              <input type="hidden" name="entityId" value={entityId} />
              <ViajeCampos rotulo={rotulo} />
            </FormModal>
            {mostrarDestinatarios && (
              <FormModal
                triggerLabel="Nuevo destinatario"
                title={`Nuevo destinatario — por cuenta de ${entityName}`}
                action={crearDestinatario}
                iconName="edit"
                peso="secundario"
              >
                <input type="hidden" name="entityId" value={entityId} />
                <p className="text-xs text-foreground/50">
                  Los clientes de {entityName}, a cuyo nombre se emite la factura. No son clientes
                  tuyos: no tienen cuenta ni saldo, y la deuda te la sigue debiendo {entityName}. Lo
                  único que se guarda de ellos es el nombre y el CUIT, que es lo que necesita el
                  libro de IVA.
                </p>
                <DestinatarioCampos />
                <button type="submit" className={submitClass}>
                  Agregar
                </button>
              </FormModal>
            )}
          </div>
        )}
      </div>

      {conSaldo.length > 0 || fuera.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {conSaldo.map((v) => {
            const pagado = v.total.greaterThan(0) ? Math.min(Math.max(v.cobrado.div(v.total).toNumber(), 0), 1) : 0;
            return (
              <Link
                key={v.id}
                href={`/cuentas-corrientes/${entitySlug}/viaje/${v.id}`}
                className="group flex min-w-0 flex-col gap-3 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm transition-colors hover:border-foreground/25"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium group-hover:underline">
                    {v.nombre}
                    {v.destino && <span className="font-normal text-foreground/50"> · {v.destino}</span>}
                  </p>
                  <p className="text-xs text-foreground/50">
                    {formatFecha(v.fecha)} · {v.comprobantes} {v.comprobantes === 1 ? "comprobante" : "comprobantes"}
                  </p>
                </div>
                {/* El monto pegado al nombre y la barra al pie: así los montos quedan a la misma altura
                    aunque el "de $ ..." de alguna ocupe dos renglones. */}
                <div className="flex flex-1 flex-col">
                  <p className={`text-xl font-semibold tabular-nums ${v.saldo.isNegative() ? "text-green-700 dark:text-green-400" : ""}`}>
                    {formatMoney(v.saldo, moneda)}
                  </p>
                  {v.saldo.isNegative() ? (
                    <p className="text-xs text-foreground/50">a favor {esProveedor ? "nuestro" : "del cliente"}</p>
                  ) : (
                    <div className="mt-auto pt-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                        <div className="h-full rounded-full bg-green-600/70" style={{ width: `${pagado * 100}%` }} />
                      </div>
                      <p className="mt-1 text-xs tabular-nums text-foreground/50">
                        {saldadoComo} {formatMoney(v.cobrado, moneda)} de {formatMoney(v.total, moneda)}
                      </p>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
          {/* Sin esta tarjeta la suma de las partes no da el saldo de la ficha y no hay manera de
              saber qué quedó afuera: el saldo inicial viejo, o algo cargado sin elegir la parte. */}
          {fuera.length > 0 && (
            <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-dashed border-foreground/20 p-4">
              <div>
                <p className="font-medium text-foreground/70">Sin asignar</p>
                <p className="text-xs text-foreground/50">
                  Fuera de {genero.articulo === "la" ? "las" : "los"} {plural.toLowerCase()} ·{" "}
                  {fuera.map((s) => (s.circuito === "BLANCO" ? "Cuenta 1" : "Cuenta 2")).join(" y ")}
                </p>
              </div>
              <p className="text-xl font-semibold tabular-nums text-foreground/70">{formatMoney(montoFuera, moneda)}</p>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-foreground/15 px-4 py-6 text-center text-sm text-foreground/50">
          {viajes.length === 0
            ? `Todavía no hay nada. Sirve para partir la cuenta de ${entityName} en pedazos con saldo propio, y que cada pago cancele sólo lo de su parte.`
            : `${genero.articulo === "la" ? "Todas" : "Todos"} saldad${genero.articulo === "la" ? "as" : "os"}: no hay nada pendiente.`}
        </p>
      )}

      {(viajes.length > 0 || destinatarios.length > 0) && (
        <details className="group rounded-xl border border-foreground/10 bg-background shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 text-sm text-foreground/60 hover:bg-foreground/[0.02] hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight size={15} className="shrink-0 transition-transform group-open:rotate-90" />
            {canEdit ? `Editar ${plural.toLowerCase()}` : `${todos[0].toUpperCase()}${todos.slice(1)} ${genero.articulo === "la" ? "las" : "los"} ${plural.toLowerCase()}`}
            <span className="text-foreground/40">
              · {viajes.length} en total{saldados > 0 ? `, ${saldados} ${genero.articulo === "la" ? "saldada" : "saldado"}${saldados === 1 ? "" : "s"}` : ""}
              {mostrarDestinatarios && destinatarios.length > 0 ? ` · ${destinatarios.length} destinatarios` : ""}
            </span>
          </summary>
          <div className="divide-y divide-foreground/10 border-t border-foreground/10">
            {viajes.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <Link href={`/cuentas-corrientes/${entitySlug}/viaje/${v.id}`} className="text-sm font-medium hover:underline">
                    {v.nombre}
                    {v.destino && <span className="font-normal text-foreground/50"> · {v.destino}</span>}
                  </Link>
                  <p className="text-xs text-foreground/50">
                    {formatFecha(v.fecha)} · {v.comprobantes} {v.comprobantes === 1 ? "comprobante" : "comprobantes"} · {saldadoComo.toLowerCase()}{" "}
                    {formatMoney(v.cobrado, moneda)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p
                    className={`text-sm font-semibold tabular-nums ${
                      v.saldo.isZero() ? "text-foreground/40" : v.saldo.isNegative() ? "text-green-700 dark:text-green-400" : ""
                    }`}
                  >
                    {formatMoney(v.saldo, moneda)}
                  </p>
                  {canEdit && (
                    <span className="flex items-center gap-1">
                      <FormModal triggerLabel="Editar" soloIcono title={`Editar ${v.nombre}`} action={actualizarEntrega} iconName="edit">
                        <input type="hidden" name="entregaId" value={v.id} />
                        <ViajeCampos
                          rotulo={rotulo}
                          defaultValues={{
                            nombre: v.nombre,
                            destino: v.destino ?? "",
                            fecha: toDateInputValue(v.fecha),
                            notas: v.notas ?? "",
                          }}
                          submitLabel="Guardar"
                        />
                      </FormModal>
                      <DeleteButton
                        action={borrarEntrega}
                        hiddenName="entregaId"
                        hiddenValue={v.id}
                        nombre={v.nombre}
                        consecuencia="Sólo se puede si no tiene comprobantes ni pagos."
                      />
                    </span>
                  )}
                </div>
              </div>
            ))}
            {mostrarDestinatarios && destinatarios.length > 0 && (
              <div className="space-y-2 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">A nombre de</p>
                {destinatarios.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      {d.nombre}
                      {d.taxId ? (
                        <span className="text-foreground/50"> · {d.taxId}</span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400"> · sin CUIT</span>
                      )}
                    </span>
                    {canEdit && (
                      <span className="flex shrink-0 items-center gap-1">
                        <FormModal
                          triggerLabel="Editar"
                          soloIcono
                          title={`Editar ${d.nombre}`}
                          action={actualizarDestinatario}
                          iconName="edit"
                        >
                          <input type="hidden" name="destinatarioId" value={d.id} />
                          <DestinatarioCampos defaultValues={d} />
                          <button type="submit" className={submitClass}>
                            Guardar
                          </button>
                        </FormModal>
                        <DeleteButton
                          action={borrarDestinatario}
                          hiddenName="destinatarioId"
                          hiddenValue={d.id}
                          nombre={`a ${d.nombre}`}
                          consecuencia="Sólo se puede si no figura en ningún comprobante."
                        />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </section>
  );
}

function ViajeCampos({
  rotulo = "Viaje",
  defaultValues,
  submitLabel,
}: {
  rotulo?: string;
  defaultValues?: { nombre: string; destino: string; fecha: string; notas: string };
  submitLabel?: string;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Nombre">
          <input
            name="nombre"
            required
            placeholder={rotulo === "Viaje" ? "Camión 4" : "Alquiler"}
            defaultValue={defaultValues?.nombre}
            className={inputClass}
          />
        </Campo>
        <Campo label="Destino (opcional)">
          <input
            name="destino"
            placeholder="Santa Fe"
            defaultValue={defaultValues?.destino}
            className={inputClass}
          />
        </Campo>
        <Campo label="Fecha">
          <input
            type="date"
            name="fecha"
            required
            defaultValue={defaultValues?.fecha ?? hoyEnInput()}
            className={inputClass}
          />
        </Campo>
        <Campo label="Notas (opcional)">
          <input name="notas" defaultValue={defaultValues?.notas} className={inputClass} />
        </Campo>
      </div>
      <button type="submit" className={submitClass}>
        {submitLabel ?? `Crear ${rotulo.toLowerCase()}`}
      </button>
    </>
  );
}

function DestinatarioCampos({ defaultValues }: { defaultValues?: { nombre: string; taxId: string | null } }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Campo label="Nombre">
        <input
          name="nombre"
          required
          placeholder="Don Ángel"
          defaultValue={defaultValues?.nombre}
          className={inputClass}
        />
      </Campo>
      <Campo label="CUIT">
        <input name="taxId" defaultValue={defaultValues?.taxId ?? ""} className={inputClass} />
      </Campo>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm">{label}</label>
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
