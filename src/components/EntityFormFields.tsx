import type { Entity } from "@prisma/client";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { RUBRO_GRUPOS, rubroDeEntidad } from "@/lib/rubro-proveedor";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const selectClass = inputClass;
const tituloClass = "text-xs font-medium uppercase tracking-wide text-foreground/40";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

export function EntityFormFields({
  mostrarRetiroSocietario = false,
  defaultType,
  showSupplierCategory,
  entity,
  saldosIniciales,
}: {
  defaultType: "CLIENTE" | "PROVEEDOR";
  /** La casilla de retiro societario: sólo al editar, y sólo para Admin. */
  mostrarRetiroSocietario?: boolean;
  showSupplierCategory?: boolean;
  /** Si viene, el formulario edita esta entidad en vez de crear una nueva. */
  entity?: Entity;
  /** Al editar: los saldos iniciales que ya tiene cargados, para poder corregirlos. */
  saldosIniciales?: { blanco: string; negro: string };
}) {
  const isEdit = Boolean(entity);
  const esProveedor = (entity?.type ?? defaultType) !== "CLIENTE";

  return (
    <>
      {isEdit && <input type="hidden" name="entityId" value={entity!.id} />}
      <input type="hidden" name="type" value={entity?.type ?? defaultType} />

      {/* Dos bloques: quién es, y cómo se lleva su cuenta. Antes iba todo seguido y las opciones
          de la cuenta quedaban perdidas entre el teléfono y la dirección. */}
      <section className="space-y-3">
        <h3 className={tituloClass}>Datos</h3>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="name">
            Nombre
          </label>
          <input id="name" name="name" required defaultValue={entity?.name} placeholder="Razón social o nombre" className={inputClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm" htmlFor="taxId">
              CUIT
            </label>
            <input id="taxId" name="taxId" defaultValue={entity?.taxId ?? ""} placeholder="20-12345678-9" className={inputClass} />
          </div>
          {showSupplierCategory && (
            <div className="space-y-1">
              <label className="text-sm" htmlFor="rubro">
                Rubro
              </label>
              {/* Insumos y servicios en el mismo desplegable: un transportista o la luz no encajan en
                  ninguna categoría de insumo, y mandarlos a "Otro" los mezclaba con los que sí. */}
              <select id="rubro" name="rubro" defaultValue={rubroDeEntidad(entity)} className={selectClass}>
                <option value="">— Elegir —</option>
                {RUBRO_GRUPOS.map((grupo) => (
                  <optgroup key={grupo.label} label={grupo.label}>
                    {grupo.opciones.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm" htmlFor="phone">
              Teléfono
            </label>
            <input id="phone" name="phone" defaultValue={entity?.phone ?? ""} placeholder="011 1234-5678" className={inputClass} />
          </div>
          {/* Sin rubro quedan tres: el email va a lo ancho en vez de solo a media fila. */}
          <div className={`space-y-1 ${showSupplierCategory ? "" : "col-span-2"}`}>
            <label className="text-sm" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" defaultValue={entity?.email ?? ""} placeholder="email@ejemplo.com" className={inputClass} />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="address">
            Dirección
          </label>
          <input id="address" name="address" defaultValue={entity?.address ?? ""} placeholder="Calle 123, Ciudad" className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="notes">
            Notas
          </label>
          <textarea id="notes" name="notes" defaultValue={entity?.notes ?? ""} placeholder="Observaciones…" rows={2} className={inputClass} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isWithholdingAgent" defaultChecked={entity?.isWithholdingAgent} className="size-4 accent-primary" />
          Es agente de retención o percepción
        </label>
      </section>

      <section className="space-y-3 border-t border-foreground/10 pt-4">
        <h3 className={tituloClass}>La cuenta</h3>
        <div className="space-y-1">
          <p className="text-sm">
            Saldo inicial <span className="text-foreground/50">(opcional)</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-foreground/70" htmlFor="saldoInicialBlanco">
                {CIRCUIT_LABELS.BLANCO}
              </label>
              <input
                id="saldoInicialBlanco"
                name="saldoInicialBlanco"
                inputMode="decimal"
                placeholder="0,00"
                defaultValue={saldosIniciales?.blanco ?? ""}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-foreground/70" htmlFor="saldoInicialNegro">
                {CIRCUIT_LABELS.NEGRO}
              </label>
              <input
                id="saldoInicialNegro"
                name="saldoInicialNegro"
                inputMode="decimal"
                placeholder="0,00"
                defaultValue={saldosIniciales?.negro ?? ""}
                className={inputClass}
              />
            </div>
          </div>
          <p className="text-xs text-foreground/50">
            {esProveedor ? "Lo que se le debe" : "Lo que nos debe"}. A favor {esProveedor ? "nuestro" : "del cliente"}, con signo menos:
            −25.000.
            {isEdit && " Vacío lo borra, sin tocar el resto de la cuenta."}
          </p>
        </div>

        <div className="space-y-2">
          <Opcion name="cuentaEnDolares" defaultChecked={entity?.moneda === "USD"} titulo="La cuenta va en dólares">
            El saldo queda en U$S; lo que se paga en pesos se convierte con su cotización.
          </Opcion>
          {/* Con la casilla tildada aparece el nombre de las partes: sin dividir, la pregunta no
              tiene sentido. Es CSS puro (`has-checked`), así el formulario sigue sin JavaScript. */}
          <div className="group/partes">
            <Opcion name="llevaViajes" defaultChecked={entity?.llevaViajes ?? false} titulo="Dividir la cuenta en partes">
              Cada parte —un camión, el alquiler— con su propio saldo, y cada pago cancela sólo la suya.
            </Opcion>
            <div className="mt-2 hidden space-y-1 pl-9 group-has-checked/partes:block">
              <label className="text-xs text-foreground/70" htmlFor="rotuloSubcuenta">
                Cómo se llama cada parte
              </label>
              <input
                id="rotuloSubcuenta"
                name="rotuloSubcuenta"
                placeholder="Viaje"
                defaultValue={entity?.rotuloSubcuenta ?? ""}
                className={inputClass}
              />
              <p className="text-xs text-foreground/50">«Viaje» para los camiones, «Subcuenta» para el alquiler. Vacío = Viaje.</p>
            </div>
          </div>
          {esProveedor && (
            <Opcion name="llevaCuentaPreformas" defaultChecked={entity?.llevaCuentaPreformas ?? false} titulo="Lleva cuenta de preformas">
              Para el que fía la preforma y cobra el soplado: una segunda cuenta, en unidades.
            </Opcion>
          )}
          {/* La marca de por dónde se retira para los socios no se ofrece al crear —un proveedor
              nuevo nunca nace siendo eso— ni a quien no maneja la plata de los dueños. Se prende
              editando, y sólo Admin lo ve. */}
          {esProveedor && mostrarRetiroSocietario && (
            <>
              {/* Marca que el formulario SÍ trae la casilla. Sin esto, guardar desde un formulario
                  que no la muestra la apagaría: una casilla sin tildar y una que no existe llegan igual. */}
              <input type="hidden" name="retiroSocietarioPresente" value="1" />
              <Opcion name="retiroSocietario" defaultChecked={entity?.retiroSocietario ?? false} titulo="Por acá se retira para los socios">
                Lo que quede a favor nuestro no cuenta como deuda del proveedor: se muestra aparte, como retiro societario.
              </Opcion>
            </>
          )}
        </div>
      </section>

      <button type="submit" className={submitClass}>
        {isEdit ? "Guardar cambios" : "Crear"}
      </button>
    </>
  );
}

/** Una casilla con su explicación en una línea, en una tarjetita que se marca al tildarla. */
function Opcion({
  name,
  defaultChecked,
  titulo,
  children,
}: {
  name: string;
  defaultChecked: boolean;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-foreground/10 px-3 py-2.5 transition-colors hover:bg-foreground/[0.02] has-checked:border-primary/60 has-checked:bg-primary/10">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 shrink-0 accent-primary" />
      <span className="text-sm">
        {titulo}
        <span className="block text-xs text-foreground/50">{children}</span>
      </span>
    </label>
  );
}
