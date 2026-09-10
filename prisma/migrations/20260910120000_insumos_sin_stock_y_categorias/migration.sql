-- Insumos que no llevan stock, y categorías para los consumibles.
--
-- `llevaStock` en false significa que la compra le carga el gasto a la cuenta corriente pero no
-- genera movimiento de stock. Es para los consumibles que se compran y no se cuentan —pegamento,
-- stretch—: hoy toda compra suma stock y ninguna receta los consume, así que su número crecería
-- para siempre sin significar nada.
--
-- Reemplaza a `isResellable`, que se guardaba y no lo leía nadie. Estaba pensado para marcar los
-- insumos revendibles, pero ahora cualquiera se puede vender desde su ficha, así que sobra.
--
-- PALLET_DESCARTABLE va aparte de PALLET_NORMALIZADO a propósito: el desplegable que elige el
-- pallet de una receta filtra por esa categoría, y el descartable no es una opción válida ahí.
--
-- Los insumos se crean en la migración siguiente y no en esta: PostgreSQL no deja *usar* un valor
-- de enum en la misma transacción que lo agrega.

ALTER TYPE "SupplierCategory" ADD VALUE 'PEGAMENTO';
ALTER TYPE "SupplierCategory" ADD VALUE 'STRETCH';
ALTER TYPE "SupplierCategory" ADD VALUE 'PALLET_DESCARTABLE';

ALTER TABLE "Item" DROP COLUMN "isResellable",
ADD COLUMN     "llevaStock" BOOLEAN NOT NULL DEFAULT true;
