import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Cómo se ordena un listado de cuentas corrientes.
 *
 * El alfabético es el de siempre y queda por defecto: es como se busca a alguien que ya se sabe
 * cómo se llama. Los de saldo son para la otra pregunta —a quién le debemos más, quién nos debe
 * más— que antes había que contestar leyendo la columna fila por fila.
 */
export const ORDENES = [
  { value: "", label: "Nombre (A-Z)" },
  { value: "z-a", label: "Nombre (Z-A)" },
  { value: "blanco-desc", label: "Saldo Blanco: mayor a menor" },
  { value: "blanco-asc", label: "Saldo Blanco: menor a mayor" },
  { value: "negro-desc", label: "Saldo Negro: mayor a menor" },
  { value: "negro-asc", label: "Saldo Negro: menor a mayor" },
] as const;

export type OrdenKey = (typeof ORDENES)[number]["value"];

export function esOrdenValido(value: string | undefined): value is OrdenKey {
  return ORDENES.some((o) => o.value === (value ?? ""));
}

type FilaOrdenable = {
  entity: { name: string };
  blancoSaldo: Prisma.Decimal | null;
  negroSaldo: Prisma.Decimal | null;
};

export function ordenarFilas<T extends FilaOrdenable>(filas: T[], orden: string | undefined): T[] {
  const porNombre = (a: T, b: T) => a.entity.name.localeCompare(b.entity.name, "es");
  const valor = (f: T, circuito: "blanco" | "negro") =>
    Number((circuito === "blanco" ? f.blancoSaldo : f.negroSaldo) ?? 0);

  // Una copia: el array que llega viene de una consulta y ordenarlo en el lugar ensucia lo que
  // sea que lo esté usando además.
  const copia = [...filas];

  switch (orden) {
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
    default:
      return copia.sort(porNombre);
  }
}
