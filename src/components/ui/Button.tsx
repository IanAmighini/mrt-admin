import Link from "next/link";

/**
 * Los tres pesos de botón que usa la app, en un solo lugar.
 *
 * El amarillo estaba escrito a mano 49 veces, y eso tiene un costo que no es estético: cuando
 * **todo** es primario, nada lo es. En la ficha de un cliente hay seis botones idénticos, y el que
 * se usa veinte veces por día se ve igual que el que se usa una vez por mes.
 */
export type PesoDeBoton = "primario" | "secundario" | "discreto";

export function buttonClass(peso: PesoDeBoton = "primario", extra?: string) {
  const base = "rounded-lg px-4 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30";
  const porPeso: Record<PesoDeBoton, string> = {
    primario: "bg-primary font-medium text-primary-foreground shadow-sm hover:bg-primary-hover",
    secundario: "border border-foreground/20 bg-background hover:bg-foreground/5",
    discreto: "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
  };
  return [base, porPeso[peso], extra ?? ""].filter(Boolean).join(" ");
}

export function Button({
  peso = "primario",
  className,
  ...props
}: { peso?: PesoDeBoton } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={buttonClass(peso, className)} />;
}

/** El mismo botón cuando en realidad es un link — un filtro, un "ver todo", un volver. */
export function ButtonLink({
  peso = "secundario",
  className,
  ...props
}: { peso?: PesoDeBoton } & React.ComponentProps<typeof Link>) {
  return <Link {...props} className={buttonClass(peso, className)} />;
}
