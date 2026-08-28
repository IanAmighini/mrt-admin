import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatQuantity } from "@/lib/money";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import {
  createFormato,
  createMarca,
  deleteFormato,
  deleteMarca,
  updateFormato,
  updateMarca,
} from "./actions";

const inputClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

export default async function CatalogoPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const [marcas, formatos] = await Promise.all([
    prisma.marca.findMany({ orderBy: [{ name: "asc" }, { oilType: "asc" }] }),
    prisma.formato.findMany({ orderBy: [{ bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }] }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/produccion" className="text-sm underline underline-offset-2">
          ← Producción
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Catálogo</h1>
        <p className="text-sm text-foreground/60">
          Marcas y formatos de pallet reutilizables al cargar producción.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Marcas</h2>
          {canEdit && (
            <FormModal triggerLabel="Nueva marca" title="Nueva marca" action={createMarca}>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="new-marca-name">
                  Nombre
                </label>
                <input id="new-marca-name" name="name" required placeholder="Bonanza" className={inputClass} />
              </div>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="new-marca-oilType">
                  Tipo de aceite
                </label>
                <input
                  id="new-marca-oilType"
                  name="oilType"
                  required
                  placeholder="Girasol"
                  className={inputClass}
                />
              </div>
              <button
                type="submit"
                className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
              >
                Crear
              </button>
            </FormModal>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 px-4">Marca</th>
                <th className="py-2 px-4">Tipo de aceite</th>
                {canEdit && <th className="py-2 px-4"></th>}
              </tr>
            </thead>
            <tbody>
              {marcas.map((marca) => (
                <tr key={marca.id} className="border-b border-foreground/5 last:border-0">
                  <td className="py-2 px-4">{marca.name}</td>
                  <td className="py-2 px-4">{marca.oilType}</td>
                  {canEdit && (
                    <td className="py-2 px-4">
                      <div className="flex items-center gap-3">
                        <FormModal
                          triggerLabel="Editar"
                          title="Editar marca"
                          action={updateMarca}
                          iconName="edit"
                        >
                          <input type="hidden" name="marcaId" value={marca.id} />
                          <div className="space-y-1">
                            <label className="text-sm" htmlFor={`marca-name-${marca.id}`}>
                              Nombre
                            </label>
                            <input
                              id={`marca-name-${marca.id}`}
                              name="name"
                              required
                              defaultValue={marca.name}
                              className={inputClass}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-sm" htmlFor={`marca-oilType-${marca.id}`}>
                              Tipo de aceite
                            </label>
                            <input
                              id={`marca-oilType-${marca.id}`}
                              name="oilType"
                              required
                              defaultValue={marca.oilType}
                              className={inputClass}
                            />
                          </div>
                          <button
                            type="submit"
                            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
                          >
                            Guardar cambios
                          </button>
                        </FormModal>
                        <DeleteButton
                          action={deleteMarca}
                          hiddenName="marcaId"
                          hiddenValue={marca.id}
                          confirmMessage={`¿Borrar la marca "${marca.name} ${marca.oilType}"? No afecta a los productos que ya existan con ese nombre.`}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {marcas.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 3 : 2} className="py-6 text-center text-foreground/40">
                    Todavía no hay marcas cargadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Formatos de pallet</h2>
          {canEdit && (
            <FormModal triggerLabel="Nuevo formato" title="Nuevo formato" action={createFormato}>
              <div className="space-y-1">
                <label className="text-sm" htmlFor="new-formato-presentation">
                  Presentación
                </label>
                <input
                  id="new-formato-presentation"
                  name="presentation"
                  required
                  placeholder="105x12x850"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-sm" htmlFor="new-formato-boxesPerPallet">
                    Cajas por pallet
                  </label>
                  <input
                    id="new-formato-boxesPerPallet"
                    name="boxesPerPallet"
                    required
                    inputMode="numeric"
                    placeholder="105"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm" htmlFor="new-formato-unitsPerBox">
                    Botellas por caja
                  </label>
                  <input
                    id="new-formato-unitsPerBox"
                    name="unitsPerBox"
                    required
                    inputMode="numeric"
                    placeholder="12"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm" htmlFor="new-formato-bottleCapacityMl">
                    Capacidad (ml)
                  </label>
                  <input
                    id="new-formato-bottleCapacityMl"
                    name="bottleCapacityMl"
                    required
                    inputMode="decimal"
                    placeholder="850"
                    className={inputClass}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
              >
                Crear
              </button>
            </FormModal>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 px-4">Presentación</th>
                <th className="py-2 px-4">Cajas por pallet</th>
                <th className="py-2 px-4">Botellas por caja</th>
                <th className="py-2 px-4">Capacidad (ml)</th>
                {canEdit && <th className="py-2 px-4"></th>}
              </tr>
            </thead>
            <tbody>
              {formatos.map((formato) => (
                <tr key={formato.id} className="border-b border-foreground/5 last:border-0">
                  <td className="py-2 px-4">{formato.presentation}</td>
                  <td className="py-2 px-4">{formato.boxesPerPallet}</td>
                  <td className="py-2 px-4">{formato.unitsPerBox}</td>
                  <td className="py-2 px-4">{formatQuantity(formato.bottleCapacityMl)}</td>
                  {canEdit && (
                    <td className="py-2 px-4">
                      <div className="flex items-center gap-3">
                        <FormModal
                          triggerLabel="Editar"
                          title="Editar formato"
                          action={updateFormato}
                          iconName="edit"
                        >
                          <input type="hidden" name="formatoId" value={formato.id} />
                          <div className="space-y-1">
                            <label className="text-sm" htmlFor={`formato-presentation-${formato.id}`}>
                              Presentación
                            </label>
                            <input
                              id={`formato-presentation-${formato.id}`}
                              name="presentation"
                              required
                              defaultValue={formato.presentation}
                              className={inputClass}
                            />
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <label className="text-sm" htmlFor={`formato-boxes-${formato.id}`}>
                                Cajas por pallet
                              </label>
                              <input
                                id={`formato-boxes-${formato.id}`}
                                name="boxesPerPallet"
                                required
                                inputMode="numeric"
                                defaultValue={formato.boxesPerPallet}
                                className={inputClass}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-sm" htmlFor={`formato-units-${formato.id}`}>
                                Botellas por caja
                              </label>
                              <input
                                id={`formato-units-${formato.id}`}
                                name="unitsPerBox"
                                required
                                inputMode="numeric"
                                defaultValue={formato.unitsPerBox}
                                className={inputClass}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-sm" htmlFor={`formato-ml-${formato.id}`}>
                                Capacidad (ml)
                              </label>
                              <input
                                id={`formato-ml-${formato.id}`}
                                name="bottleCapacityMl"
                                required
                                inputMode="decimal"
                                defaultValue={formato.bottleCapacityMl.toString()}
                                className={inputClass}
                              />
                            </div>
                          </div>
                          <button
                            type="submit"
                            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
                          >
                            Guardar cambios
                          </button>
                        </FormModal>
                        <DeleteButton
                          action={deleteFormato}
                          hiddenName="formatoId"
                          hiddenValue={formato.id}
                          confirmMessage={`¿Borrar el formato "${formato.presentation}"? No afecta a los productos que ya existan con esa presentación.`}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {formatos.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 5 : 4} className="py-6 text-center text-foreground/40">
                    Todavía no hay formatos cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
