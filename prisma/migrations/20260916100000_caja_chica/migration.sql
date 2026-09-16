-- Rubros para lo que sale de la caja y no tiene proveedor: sueldos, limpieza, un remís, la librería.
ALTER TYPE "ExpenseCategory" ADD VALUE 'SUELDOS';
ALTER TYPE "ExpenseCategory" ADD VALUE 'LIMPIEZA';
ALTER TYPE "ExpenseCategory" ADD VALUE 'MOVILIDAD';
ALTER TYPE "ExpenseCategory" ADD VALUE 'OFICINA';

-- GASTO: plata que sale de la caja y no cancela ninguna cuenta corriente — lleva rubro y cuenta
-- como gasto del mes. PASE: plata que se mueve de una caja a otra, que no es ni ingreso ni egreso.
ALTER TYPE "TreasuryMovementCategory" ADD VALUE 'GASTO';
ALTER TYPE "TreasuryMovementCategory" ADD VALUE 'PASE';

-- Las dos patas de un pase entre cajas, atadas: al borrar una se va la otra.
ALTER TABLE "Document" ADD COLUMN     "contraparteId" TEXT;

CREATE UNIQUE INDEX "Document_contraparteId_key" ON "Document"("contraparteId");

ALTER TABLE "Document" ADD CONSTRAINT "Document_contraparteId_fkey" FOREIGN KEY ("contraparteId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
