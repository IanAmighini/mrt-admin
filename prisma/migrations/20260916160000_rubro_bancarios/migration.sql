-- Comisiones y mantenimiento del banco. Hasta ahora un movimiento de tesorería con categoría
-- "Gasto bancario" no tenía rubro, así que sumaba al total del mes sin aparecer en ninguna fila.
ALTER TYPE "ExpenseCategory" ADD VALUE 'BANCARIOS';
