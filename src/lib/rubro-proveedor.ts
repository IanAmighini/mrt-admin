import type { Entity, ExpenseCategory, SupplierCategory } from "@prisma/client";
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_PROVEEDOR_ORDER,
  SUPPLIER_CATEGORY_LABELS,
  SUPPLIER_CATEGORY_ORDER,
} from "@/lib/labels";

/**
 * El rubro de un proveedor, que puede ser de dos naturalezas distintas: lo que nos vende (un
 * insumo) o lo que nos factura (un gasto). Un transportista o Edenor no encajan en ninguna
 * categoría de insumo, y dejarlos en "Otro" los mezclaba con los que sí lo son.
 *
 * Viaja como un solo valor con prefijo para que el formulario sea un desplegable y no un campo más
 * un selector de qué campo es.
 */
export const RUBRO_GRUPOS: { label: string; opciones: { value: string; label: string }[] }[] = [
  {
    label: "Insumos",
    opciones: SUPPLIER_CATEGORY_ORDER.map((c) => ({
      value: `insumo:${c}`,
      label: SUPPLIER_CATEGORY_LABELS[c],
    })),
  },
  {
    label: "Servicios y gastos",
    opciones: EXPENSE_CATEGORY_PROVEEDOR_ORDER.map((c) => ({
      value: `gasto:${c}`,
      label: EXPENSE_CATEGORY_LABELS[c],
    })),
  },
];

/** El valor que le corresponde a una entidad ya guardada, para preseleccionar el desplegable. */
export function rubroDeEntidad(entity: Pick<Entity, "supplierCategory" | "expenseCategory"> | undefined | null): string {
  if (entity?.supplierCategory) return `insumo:${entity.supplierCategory}`;
  if (entity?.expenseCategory) return `gasto:${entity.expenseCategory}`;
  return "";
}

/** Cómo se muestra el rubro en una lista. */
export function rubroLabel(entity: Pick<Entity, "supplierCategory" | "expenseCategory">): string | null {
  if (entity.supplierCategory) return SUPPLIER_CATEGORY_LABELS[entity.supplierCategory];
  if (entity.expenseCategory) return EXPENSE_CATEGORY_LABELS[entity.expenseCategory];
  return null;
}

/**
 * Parte el valor del formulario en las dos columnas. Siempre devuelve las dos, con la que no
 * corresponde en null: así cambiar un proveedor de insumos a uno de servicios limpia la vieja en
 * vez de dejar las dos cargadas.
 */
export function parseRubro(raw: string): {
  supplierCategory: SupplierCategory | null;
  expenseCategory: ExpenseCategory | null;
} {
  const [tipo, valor] = raw.split(":");
  if (tipo === "insumo" && valor in SUPPLIER_CATEGORY_LABELS) {
    return { supplierCategory: valor as SupplierCategory, expenseCategory: null };
  }
  if (tipo === "gasto" && valor in EXPENSE_CATEGORY_LABELS) {
    return { supplierCategory: null, expenseCategory: valor as ExpenseCategory };
  }
  return { supplierCategory: null, expenseCategory: null };
}
