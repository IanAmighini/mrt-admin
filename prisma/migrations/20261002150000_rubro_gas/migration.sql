-- El gas de los autoelevadores, como rubro de gasto propio.
--
-- Va después de COMBUSTIBLE para que quede al lado en los desplegables que ordenan por el enum, y
-- separado de SERVICIOS, que es el gas de red del lugar.
--
-- Nada inserta todavía con este valor: Postgres no deja usar un valor de enum en la misma
-- transacción que lo agrega, así que si en algún momento hay que cargar filas con 'GAS', va en
-- otra migración.
ALTER TYPE "ExpenseCategory" ADD VALUE 'GAS' AFTER 'COMBUSTIBLE';
