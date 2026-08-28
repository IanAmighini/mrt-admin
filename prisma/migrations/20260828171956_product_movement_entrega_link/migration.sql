-- AlterEnum
ALTER TYPE "ProductMovementType" ADD VALUE 'ENTREGA';

-- AlterTable
ALTER TABLE "ProductMovement" ADD COLUMN     "documentLineId" TEXT;

-- CreateIndex
CREATE INDEX "ProductMovement_documentLineId_idx" ON "ProductMovement"("documentLineId");

-- AddForeignKey
ALTER TABLE "ProductMovement" ADD CONSTRAINT "ProductMovement_documentLineId_fkey" FOREIGN KEY ("documentLineId") REFERENCES "DocumentLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
