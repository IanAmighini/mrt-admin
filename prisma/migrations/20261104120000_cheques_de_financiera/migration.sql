-- AlterEnum
ALTER TYPE "TreasuryMovementCategory" ADD VALUE 'INGRESO_FINANCIERO';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "cobroDeFinancieraId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Document_cobroDeFinancieraId_key" ON "Document"("cobroDeFinancieraId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_cobroDeFinancieraId_fkey" FOREIGN KEY ("cobroDeFinancieraId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
