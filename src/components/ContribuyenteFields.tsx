const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";

/** Los datos que van en el encabezado del libro de IVA, los mismos de la planilla de papel. */
export function ContribuyenteFields({
  defaultValues,
}: {
  defaultValues: { nombre: string; cuit: string };
}) {
  return (
    <>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="contribuyenteNombre">
          Contribuyente
        </label>
        <input
          id="contribuyenteNombre"
          name="contribuyenteNombre"
          required
          defaultValue={defaultValues.nombre}
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="contribuyenteCuit">
          C.U.I.T.
        </label>
        <input
          id="contribuyenteCuit"
          name="contribuyenteCuit"
          required
          defaultValue={defaultValues.cuit}
          placeholder="30-71569727-7"
          className={inputClass}
        />
      </div>
      <button type="submit" className={submitClass}>
        Guardar
      </button>
    </>
  );
}
