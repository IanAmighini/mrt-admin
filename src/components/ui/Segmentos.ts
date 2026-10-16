/**
 * Las opciones de a una que se eligen con un clic —la cuenta, el medio, la caja—, todas iguales en
 * cualquier formulario: un riel con los botones adentro, el elegido en amarillo. Van sobre un
 * `<label>` con su `<input type="radio" className="sr-only">` adentro.
 */
export const segmentosClass = "flex flex-wrap gap-1 rounded-lg border border-foreground/15 p-1";
export const segmentoClass =
  "flex-1 cursor-pointer whitespace-nowrap rounded-md px-2.5 py-1.5 text-center text-sm text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground has-[:checked]:bg-primary has-[:checked]:font-medium has-[:checked]:text-primary-foreground has-[:checked]:shadow-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40";
