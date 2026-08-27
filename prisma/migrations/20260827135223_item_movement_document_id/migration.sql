-- AlterTable
ALTER TABLE "ItemMovement" ADD COLUMN     "documentId" TEXT;

-- CreateIndex
CREATE INDEX "ItemMovement_documentId_idx" ON "ItemMovement"("documentId");

-- AddForeignKey
ALTER TABLE "ItemMovement" ADD CONSTRAINT "ItemMovement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
