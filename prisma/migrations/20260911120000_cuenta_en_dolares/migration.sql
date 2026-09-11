-- Cuentas corrientes llevadas en dólares.
--
-- Hay un proveedor (el de aceite) cuya cuenta se lleva en dólares: entrega con precio en dólares, y
-- los pagos se hacen en pesos dividiendo por la cotización del día anterior. Lo que interesa saber
-- es cuántos dólares se le deben, no cuántos pesos.
--
-- `Entity.moneda` marca esas cuentas. En USD los montos de sus comprobantes y pagos **son dólares**,
-- así que el saldo sale en dólares sumando como siempre, sin convertir nada. Lo único que se agrega
-- es dónde guardar la cotización de cada pago: sin eso se pierde con cuánto se pagó y cuántos pesos
-- salieron del banco, que es justamente lo que hoy se anota a mano.
--
-- No se marca ninguna entidad acá: lo hace el usuario desde el formulario. Y no hay nada que
-- convertir — al momento de escribir esto no existe un solo documento en USD en la base.

ALTER TABLE "Entity" ADD COLUMN "moneda" "Currency" NOT NULL DEFAULT 'ARS';
ALTER TABLE "Payment" ADD COLUMN "exchangeRate" DECIMAL(12,4);
