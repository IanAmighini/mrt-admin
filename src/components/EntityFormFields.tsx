import type { Entity } from "@prisma/client";
import { SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";

const inputClass = "w-full rounded border border-black/20 px-3 py-2 text-sm";
const selectClass = inputClass;
const submitClass =
  "w-fit rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover";

export function EntityFormFields({
  defaultType,
  showSupplierCategory,
  entity,
}: {
  defaultType: "CLIENTE" | "PROVEEDOR";
  showSupplierCategory?: boolean;
  /** Si viene, el formulario edita esta entidad en vez de crear una nueva. */
  entity?: Entity;
}) {
  const isEdit = Boolean(entity);

  return (
    <>
      {isEdit && <input type="hidden" name="entityId" value={entity!.id} />}
      <input type="hidden" name="type" value={entity?.type ?? defaultType} />
      <div className="space-y-1">
        <label className="text-sm" htmlFor="name">
          Nombre
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={entity?.name}
          placeholder="Razón social o nombre"
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={entity?.email ?? ""}
            placeholder="email@ejemplo.com"
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="phone">
            Teléfono
          </label>
          <input
            id="phone"
            name="phone"
            defaultValue={entity?.phone ?? ""}
            placeholder="011 1234-5678"
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="taxId">
            CUIT
          </label>
          <input
            id="taxId"
            name="taxId"
            defaultValue={entity?.taxId ?? ""}
            placeholder="20-12345678-9"
            className={inputClass}
          />
        </div>
        {showSupplierCategory && (
          <div className="space-y-1">
            <label className="text-sm" htmlFor="supplierCategory">
              Tipo de insumo
            </label>
            <select
              id="supplierCategory"
              name="supplierCategory"
              defaultValue={entity?.supplierCategory ?? ""}
              className={selectClass}
            >
              <option value="">— Elegir —</option>
              {Object.entries(SUPPLIER_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
        {!isEdit && (
          <>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="saldoInicialBlanco">
                Saldo inicial Blanco (opcional)
              </label>
              <input
                id="saldoInicialBlanco"
                name="saldoInicialBlanco"
                inputMode="decimal"
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="saldoInicialNegro">
                Saldo inicial Negro (opcional)
              </label>
              <input
                id="saldoInicialNegro"
                name="saldoInicialNegro"
                inputMode="decimal"
                className={inputClass}
              />
            </div>
          </>
        )}
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="address">
          Dirección
        </label>
        <input
          id="address"
          name="address"
          defaultValue={entity?.address ?? ""}
          placeholder="Calle 123, Ciudad"
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="notes">
          Notas
        </label>
        <textarea
          id="notes"
          name="notes"
          defaultValue={entity?.notes ?? ""}
          placeholder="Observaciones..."
          rows={2}
          className={inputClass}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isWithholdingAgent" defaultChecked={entity?.isWithholdingAgent} />
        Es agente de retención/percepción
      </label>
      <button type="submit" className={submitClass}>
        {isEdit ? "Guardar cambios" : "Crear"}
      </button>
    </>
  );
}
