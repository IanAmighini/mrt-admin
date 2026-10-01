import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "./Button";
import { FieldChico, controlClass } from "./Field";

/**
 * La barra de filtros de una pantalla de listado.
 *
 * Hoy las diez pantallas que filtran lo hacen de diez maneras distintas: unas con botones que
 * crecen con los datos, otras con desplegables, otras con las fechas arriba y los botones abajo.
 * Aprender una no sirve para la siguiente, y es la queja con la que arrancó todo esto.
 *
 * Son un `<form>` con `method="get"`, así que los filtros viajan en la URL: se puede volver atrás,
 * guardar el link y recargar sin perder nada.
 */
export function FilterBar({
  children,
  /** La ruta a la que vuelve el botón Limpiar. Sin filtros puestos, el botón no aparece. */
  limpiarHref,
  hayFiltro,
  textoBoton = "Buscar",
}: {
  children: React.ReactNode;
  limpiarHref: string;
  hayFiltro: boolean;
  textoBoton?: string;
}) {
  return (
    <form className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {children}
        <div className="flex items-end gap-2">
          <Button type="submit">{textoBoton}</Button>
          {hayFiltro && (
            <Link
              href={limpiarHref}
              className="rounded-lg border border-foreground/20 px-4 py-2 text-sm transition-colors hover:bg-foreground/5"
            >
              Limpiar
            </Link>
          )}
        </div>
      </div>
    </form>
  );
}

/** El campo de texto con la lupa adentro, que es el filtro que tienen casi todas las pantallas. */
export function FiltroBuscar({
  defaultValue,
  placeholder,
  label = "Buscar",
  name = "q",
  className = "sm:col-span-2",
}: {
  defaultValue?: string;
  placeholder: string;
  label?: string;
  name?: string;
  className?: string;
}) {
  return (
    <FieldChico label={label} htmlFor={name} className={className}>
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40"
        />
        <input
          id={name}
          type="text"
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={controlClass({ extra: "pl-9" })}
        />
      </div>
    </FieldChico>
  );
}

/** Un desplegable de filtro. Reemplaza a las filas de botones que crecen con los datos. */
export function FiltroSelect({
  label,
  name,
  defaultValue,
  opciones,
  todos = "Todos",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  opciones: { value: string; label: string }[];
  todos?: string;
}) {
  return (
    <FieldChico label={label} htmlFor={name}>
      <select id={name} name={name} defaultValue={defaultValue ?? ""} className={controlClass()}>
        <option value="">{todos}</option>
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldChico>
  );
}

/** El rango de fechas, que siempre son dos campos juntos y siempre se llaman igual. */
export function FiltroFechas({ from, to }: { from?: string; to?: string }) {
  return (
    <>
      <FieldChico label="Desde" htmlFor="from">
        <input id="from" type="date" name="from" defaultValue={from} className={controlClass()} />
      </FieldChico>
      <FieldChico label="Hasta" htmlFor="to">
        <input id="to" type="date" name="to" defaultValue={to} className={controlClass()} />
      </FieldChico>
    </>
  );
}
