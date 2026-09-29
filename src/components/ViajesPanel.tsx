import Link from "next/link";
import { Truck } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { EntregaConSaldo } from "@/lib/entregas";
import type { DestinatarioOption } from "./ViajeFields";
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
import { toDateInputValue } from "@/lib/period";

/**
 * Los viajes de un cliente y la gente a cuyo nombre salen los papeles.
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
}: {
  entityId: string;
  entitySlug: string;
  entityName: string;
  moneda: "ARS" | "USD";
  viajes: EntregaConSaldo[];
  destinatarios: DestinatarioOption[];
  canEdit: boolean;
}) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Truck size={16} className="text-foreground/60" />
          <h2 className="text-sm font-semibold">Viajes</h2>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <FormModal triggerLabel="Nuevo viaje" title={`Nuevo viaje — ${entityName}`} action={crearEntrega}>
              <input type="hidden" name="entityId" value={entityId} />
              <ViajeCampos />
            </FormModal>
            <FormModal
              triggerLabel="Nuevo destinatario"
              title={`Nuevo destinatario — por cuenta de ${entityName}`}
              action={crearDestinatario}
              iconName="edit"
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
          </div>
        )}
      </div>

      <div className="space-y-2">
        {viajes.map((v) => (
          <div key={v.id} className="flex items-center justify-between gap-3 border-b border-foreground/5 pb-2">
            <div className="min-w-0">
              <Link
                href={`/cuentas-corrientes/${entitySlug}/viaje/${v.id}`}
                className="text-sm font-medium underline underline-offset-2"
              >
                {v.nombre}
                {v.destino && <span className="text-foreground/50"> · {v.destino}</span>}
              </Link>
              <p className="text-xs text-foreground/50">
                {v.fecha.toLocaleDateString("es-AR")} · {v.comprobantes}{" "}
                {v.comprobantes === 1 ? "comprobante" : "comprobantes"} · cobrado{" "}
                {formatMoney(v.cobrado, moneda)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p
                className={`text-sm font-semibold tabular-nums ${
                  v.saldo.isZero() ? "text-foreground/40" : v.saldo.isNegative() ? "text-green-700 dark:text-green-400" : ""
                }`}
              >
                {formatMoney(v.saldo, moneda)}
              </p>
              {canEdit && (
                <span className="flex items-center gap-1">
                  <FormModal
                    triggerLabel="Editar"
                    title={`Editar ${v.nombre}`}
                    action={actualizarEntrega}
                    iconName="edit"
                  >
                    <input type="hidden" name="entregaId" value={v.id} />
                    <ViajeCampos
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
        {viajes.length === 0 && (
          <p className="py-4 text-center text-sm text-foreground/40">
            Todavía no hay viajes. Sirven cuando un camión sale con varios remitos y {entityName} va
            pagando viaje por viaje.
          </p>
        )}
      </div>

      {destinatarios.length > 0 && (
        <div className="space-y-2 border-t border-foreground/10 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/40">
            A nombre de
          </p>
          {destinatarios.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {d.nombre}
                {d.taxId ? (
                  <span className="text-foreground/50"> · {d.taxId}</span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400"> · sin CUIT</span>
                )}
              </span>
              {canEdit && (
                <span className="flex items-center gap-1">
                  <FormModal
                    triggerLabel="Editar"
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
  );
}

function ViajeCampos({
  defaultValues,
  submitLabel = "Crear viaje",
}: {
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
            placeholder="Camión 4"
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
            defaultValue={defaultValues?.fecha ?? toDateInputValue(new Date())}
            className={inputClass}
          />
        </Campo>
        <Campo label="Notas (opcional)">
          <input name="notas" defaultValue={defaultValues?.notas} className={inputClass} />
        </Campo>
      </div>
      <button type="submit" className={submitClass}>
        {submitLabel}
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
