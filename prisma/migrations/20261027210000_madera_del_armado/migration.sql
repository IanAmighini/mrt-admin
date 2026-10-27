-- AlterTable
ALTER TABLE "ItemMovement" ADD COLUMN     "documentLineId" TEXT;

-- CreateIndex
CREATE INDEX "ItemMovement_documentLineId_idx" ON "ItemMovement"("documentLineId");

-- AddForeignKey
ALTER TABLE "ItemMovement" ADD CONSTRAINT "ItemMovement_documentLineId_fkey" FOREIGN KEY ("documentLineId") REFERENCES "DocumentLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
