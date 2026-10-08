import Link from "next/link";
import type { SupplierCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatQuantity } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";
import { getRecetasPorCombinacion, ordenarLineas, type LineaDeReceta } from "@/lib/recetas";
import { FormModal } from "@/components/Modal";
import { BotonConError } from "@/components/BotonConError";
import { FilterBar, FiltroSelect } from "@/components/ui/FilterBar";
import { APILADA } from "@/components/ui/Table";
import { crearRecetaDeCombinacion } from "./actions";

/** Las columnas de la tabla: lo que cambia de un producto a otro. El resto va junto en "Otros". */
const COLUMNAS: { categoria: SupplierCategory; titulo: string }[] = [
  { categoria: "ACEITE", titulo: "Aceite" },
  { categoria: "ENVASES", titulo: "Envase" },
  { categoria: "TAPAS", titulo: "Tapa" },
  { categoria: "ETIQUETAS", titulo: "Etiqueta" },
  { categoria: "CAJAS", titulo: "Caja" },
];

const VER = [
  { value: "", label: "Las que ya existen" },
  { value: "todas", label: "Todas las combinaciones" },
];

const selectClass =
  "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";

/** El pallet de madera va en todas: se dice una vez arriba en vez de repetirlo en cada fila. */
const esElPalletDeSiempre = (l: LineaDeReceta) => l.nombre === "Pallet de madera" && l.cantidad.equals(1);

export default async function RecetasPage({
  searchParams,
}: {
  searchParams: Promise<{ marca?: string; ver?: string }>;
}) {
  const { marca: marcaFiltro, ver } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN";
  const verTodas = ver === "todas";

  const [marcas, formatos, recetas] = await Promise.all([
    prisma.marca.findMany({ orderBy: [{ name: "asc" }, { oilType: "asc" }] }),
    prisma.formato.findMany({ orderBy: [{ bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }] }),
    getRecetasPorCombinacion(),
  ]);

  const grupos = marcas
    .filter((m) => !marcaFiltro || m.id === marcaFiltro)
    .map((marca) => ({
      marca,
      filas: formatos
        .map((formato) => ({ formato, receta: recetas.get(`${marca.id}|${formato.id}`)! }))
        // Por defecto, sólo los productos que ya existen: las combinaciones posibles son cientos y
        // la mayoría no se va a envasar nunca.
        .filter(({ receta }) => verTodas || receta.producto),
    }))
    .filter((g) => g.filas.length > 0);

  const hayOtros = grupos.some((g) =>
    g.filas.some(({ receta }) =>
      receta.lineas.some((l) => !COLUMNAS.some((c) => c.categoria === l.categoria) && !esElPalletDeSiempre(l))
    )
  );
  const columnas = 2 + COLUMNAS.length + (hayOtros ? 1 : 0) + (canEdit ? 1 : 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/produccion" className="text-sm underline underline-offset-2">
            ← Producción
          </Link>
          <h1 className="mt-2 text-xl font-semibold">Recetas</h1>
          <p className="max-w-2xl text-sm text-foreground/60">
            Lo que se descuenta de insumos por cada pallet que se carga en Producción. Todas llevan además un
            pallet de madera. Las que dicen <em>automática</em> todavía no se produjeron: se arman solas con
            esto la primera vez.
            {!canEdit && " Sólo el admin las puede cambiar."}
          </p>
        </div>
        {canEdit && (
          <FormModal triggerLabel="Nueva receta" title="Nueva receta" action={crearRecetaDeCombinacion}>
            <p className="text-sm text-foreground/60">
              Elegí la marca y el formato. Se arma la receta automática y te lleva a la ficha del producto para
              cambiar lo que haga falta.
            </p>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="nueva-marca">
                Marca
              </label>
              <select id="nueva-marca" name="marcaId" required defaultValue="" className={selectClass}>
                <option value="" disabled>
                  — Elegí la marca —
                </option>
                {marcas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatProductBrandLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm" htmlFor="nueva-formato">
                Formato
              </label>
              <select id="nueva-formato" name="formatoId" required defaultValue="" className={selectClass}>
                <option value="" disabled>
                  — Elegí el formato —
                </option>
                {formatos.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.presentation}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
            >
              Armar receta
            </button>
          </FormModal>
        )}
      </div>

      <FilterBar limpiarHref="/produccion/recetas" hayFiltro={Boolean(marcaFiltro || verTodas)} textoBoton="Ver">
        <FiltroSelect
          label="Marca"
          name="marca"
          defaultValue={marcaFiltro}
          todos="Todas las marcas"
          className="w-full sm:w-56"
          opciones={marcas.map((m) => ({ value: m.id, label: formatProductBrandLabel(m) }))}
        />
        <FiltroSelect
          label="Mostrar"
          name="ver"
          defaultValue={verTodas ? "todas" : ""}
          todos={VER[0].label}
          className="w-full sm:w-56"
          opciones={VER.filter((v) => v.value)}
        />
      </FilterBar>

      <div className="overflow-x-auto rounded-xl border border-foreground/10 bg-background shadow-sm">
        <table className={`w-full text-sm ${APILADA} max-sm:[&_tr]:px-4`}>
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 px-4">Formato</th>
              <th className="py-2 px-4">Estado</th>
              {COLUMNAS.map((c) => (
                <th key={c.categoria} className="py-2 px-4">
                  {c.titulo}
                </th>
              ))}
              {hayOtros && <th className="py-2 px-4">Otros</th>}
              {canEdit && <th className="py-2 px-4"></th>}
            </tr>
          </thead>
          {grupos.map(({ marca, filas }) => (
            <tbody key={marca.id}>
              <tr className="border-b border-foreground/10 bg-foreground/[0.03] max-sm:!block">
                <th colSpan={columnas} className="py-2 px-4 text-left font-semibold max-sm:block">
                  {formatProductBrandLabel(marca)}
                </th>
              </tr>
              {filas.map(({ formato, receta }) => {
                const lineas = ordenarLineas(receta.lineas);
                const otros = lineas.filter(
                  (l) => !COLUMNAS.some((c) => c.categoria === l.categoria) && !esElPalletDeSiempre(l)
                );
                const sinPallet = receta.lineas.length > 0 && !receta.lineas.some(esElPalletDeSiempre);
                return (
                  <tr key={formato.id} className="border-b border-foreground/5 align-top last:border-0">
                    <td className="py-2 px-4 whitespace-nowrap">
                      {receta.producto ? (
                        <Link
                          href={`/produccion/${receta.producto.slug}`}
                          className="font-medium underline underline-offset-2"
                        >
                          {formato.presentation}
                        </Link>
                      ) : (
                        <span className="font-medium">{formato.presentation}</span>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      <Estado
                        guardada={receta.guardada}
                        cambiada={receta.cambiadaAMano}
                        falta={receta.falta !== null}
                      />
                    </td>
                    {receta.falta ? (
                      <td colSpan={COLUMNAS.length + (hayOtros ? 1 : 0)} className="py-2 px-4 text-foreground/60">
                        {/* El mensaje entero repite la marca y el formato, que ya están en la fila. */}
                        {receta.falta
                          .replace(/^No se puede armar la receta de [^:]+: falta el insumo /, "Falta cargar ")
                          .replace(/ Cargalo en Stock.*$/, "")}
                      </td>
                    ) : (
                      <>
                        {COLUMNAS.map((c) => (
                          <td key={c.categoria} className="py-2 px-4">
                            <Celda lineas={lineas.filter((l) => l.categoria === c.categoria)} titulo={c.titulo} />
                          </td>
                        ))}
                        {hayOtros && (
                          <td className="py-2 px-4">
                            <Celda lineas={otros} titulo="Otros" />
                            {sinPallet && <span className="text-xs text-foreground/50">sin pallet de madera</span>}
                          </td>
                        )}
                      </>
                    )}
                    {canEdit && (
                      <td className="py-2 px-4 whitespace-nowrap">
                        {receta.producto ? (
                          <Link
                            href={`/produccion/${receta.producto.slug}`}
                            className="text-sm text-foreground/70 underline underline-offset-2"
                          >
                            Editar
                          </Link>
                        ) : (
                          !receta.falta && (
                            <BotonConError
                              action={crearRecetaDeCombinacion}
                              hidden={{ marcaId: marca.id, formatoId: formato.id }}
                              className="text-sm text-foreground/70 underline underline-offset-2"
                            >
                              Preparar
                            </BotonConError>
                          )
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          ))}
          {grupos.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={columnas} className="py-6 text-center text-foreground/40">
                  No hay recetas con este filtro.
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}

function Estado({ guardada, cambiada, falta }: { guardada: boolean; cambiada: boolean; falta: boolean }) {
  const [texto, clase] = falta
    ? ["falta un insumo", "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"]
    : !guardada
      ? ["automática", "bg-foreground/5 text-foreground/60"]
      : cambiada
        ? ["cambiada a mano", "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"]
        : ["en uso", "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"];
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${clase}`}>{texto}</span>;
}

function Celda({ lineas, titulo }: { lineas: LineaDeReceta[]; titulo: string }) {
  if (lineas.length === 0) return <span className="text-foreground/30">—</span>;
  return (
    <div className="space-y-1">
      {lineas.map((l) => (
        <div key={l.itemId}>
          {/* En el celular cada celda va apilada: sin el título no se sabe qué es cada renglón. */}
          <span className="text-xs text-foreground/50 sm:hidden">{titulo}: </span>
          <span>{l.nombre}</span>
          <span className="block text-xs tabular-nums text-foreground/50">
            {formatQuantity(l.cantidad, l.unidad === "unidad" ? "u." : l.unidad)}
          </span>
        </div>
      ))}
    </div>
  );
}
