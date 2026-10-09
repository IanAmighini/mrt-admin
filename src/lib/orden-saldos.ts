import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Cómo se ordena un listado de cuentas corrientes.
 *
 * Por defecto, de mayor a menor saldo total: la pregunta con la que se entra a la lista es quién
 * debe más (o a quién le debemos más), y antes había que contestarla leyendo la columna fila por
 * fila. Los dólares se valúan con la cotización para poder ordenarlos contra los pesos. El
 * alfabético sigue estando, para buscar a alguien que ya se sabe cómo se llama.
 */
export const ORDENES = [
  { value: "", label: "Saldo: mayor a menor" },
  { value: "a-z", label: "Nombre (A-Z)" },
  { value: "z-a", label: "Nombre (Z-A)" },
  { value: "blanco-desc", label: "Cuenta 1: mayor a menor" },
  { value: "blanco-asc", label: "Cuenta 1: menor a mayor" },
  { value: "negro-desc", label: "Cuenta 2: mayor a menor" },
  { value: "negro-asc", label: "Cuenta 2: menor a mayor" },
] as const;

export type OrdenKey = (typeof ORDENES)[number]["value"];

export function esOrdenValido(value: string | undefined): value is OrdenKey {
  return ORDENES.some((o) => o.value === (value ?? ""));
}

type FilaOrdenable = {
  entity: { name: string; moneda: string };
  total: number;
  blancoSaldo: Prisma.Decimal | null;
  negroSaldo: Prisma.Decimal | null;
};

export function ordenarFilas<T extends FilaOrdenable>(
  filas: T[],
  orden: string | undefined,
  /** Pesos por dólar, para ordenar las cuentas en dólares contra las de pesos. */
  cotizacion: number | null = null
): T[] {
  const porNombre = (a: T, b: T) => a.entity.name.localeCompare(b.entity.name, "es");
  const valor = (f: T, circuito: "blanco" | "negro") =>
    Number((circuito === "blanco" ? f.blancoSaldo : f.negroSaldo) ?? 0);

  // Una copia: el array que llega viene de una consulta y ordenarlo en el lugar ensucia lo que
  // sea que lo esté usando además.
  const copia = [...filas];

  switch (orden) {
    case "a-z":
      return copia.sort(porNombre);
    case "z-a":
      return copia.sort((a, b) => porNombre(b, a));
    case "blanco-desc":
      return copia.sort((a, b) => valor(b, "blanco") - valor(a, "blanco") || porNombre(a, b));
    case "blanco-asc":
      return copia.sort((a, b) => valor(a, "blanco") - valor(b, "blanco") || porNombre(a, b));
    case "negro-desc":
      return copia.sort((a, b) => valor(b, "negro") - valor(a, "negro") || porNombre(a, b));
    case "negro-asc":
      return copia.sort((a, b) => valor(a, "negro") - valor(b, "negro") || porNombre(a, b));
    default: {
      const enPesos = (f: T) => (f.entity.moneda === "USD" && cotizacion ? f.total * cotizacion : f.total);
      return copia.sort((a, b) => enPesos(b) - enPesos(a) || porNombre(a, b));
    }
  }
}
