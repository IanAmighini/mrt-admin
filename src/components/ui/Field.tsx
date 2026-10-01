/**
 * El campo de un formulario: la etiqueta, el control y el espacio entre los dos.
 *
 * Existe porque la clase del input estaba escrita a mano **86 veces** y declarada como `const
 * inputClass` en 35 archivos distintos. Ya había divergencias que nadie decidió —unos con `px-3`,
 * otros con `px-2`— y cualquier cambio de estilo costaba 86 ediciones.
 *
 * `controlClass` se exporta aparte porque muchos formularios arman su propio `<select>` o
 * `<textarea>` y sólo necesitan la clase; `Field` es para los que además quieren la etiqueta.
 */
export function controlClass(opciones?: { denso?: boolean; extra?: string }) {
  const padding = opciones?.denso ? "px-2 py-2" : "px-3 py-2";
  return [
    "w-full rounded-lg border border-foreground/20 bg-background text-sm transition-colors",
    "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
    padding,
    opciones?.extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function Field({
  label,
  htmlFor,
  ayuda,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  /** Una línea abajo del campo, para lo que no entra en la etiqueta. */
  ayuda?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-sm" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {ayuda && <p className="text-xs text-foreground/50">{ayuda}</p>}
    </div>
  );
}

/** La misma forma, con la etiqueta chica que usan las barras de filtro y las grillas de líneas. */
export function FieldChico({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-xs text-foreground/60" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
