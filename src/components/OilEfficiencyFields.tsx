export function OilEfficiencyFields({ currentPercent }: { currentPercent: string }) {
  return (
    <>
      <p className="text-xs text-foreground/50">
        Porcentaje del volumen nominal de la botella que realmente se consume en aceite, usado al
        generar la receta de un producto.
      </p>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="oilFillEfficiencyPercent">
          Rendimiento (%)
        </label>
        <input
          id="oilFillEfficiencyPercent"
          name="oilFillEfficiencyPercent"
          required
          defaultValue={currentPercent}
          inputMode="decimal"
          className="w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
      >
        Guardar
      </button>
    </>
  );
}
