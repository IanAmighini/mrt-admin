/*
  Warnings:

  - A unique constraint covering the columns `[sourcePaymentId]` on the table `Document` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TreasuryMovementCategory" AS ENUM ('COBRO', 'PAGO_PROVEEDOR', 'GASTO_BANCARIO', 'IMPUESTO', 'RETIRO', 'DEPOSITO', 'AJUSTE_ARQUEO', 'OTRO');

-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'TESORERIA';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "sourcePaymentId" TEXT,
ADD COLUMN     "treasuryCategory" "TreasuryMovementCategory";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "linkedPaymentId" TEXT,
ADD COLUMN     "treasuryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Document_sourcePaymentId_key" ON "Document"("sourcePaymentId");

-- CreateIndex
CREATE INDEX "Payment_treasuryId_idx" ON "Payment"("treasuryId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourcePaymentId_fkey" FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
