-- AlterTable
ALTER TABLE "EntregaPreforma" ADD COLUMN     "documentId" TEXT;

-- CreateIndex
CREATE INDEX "EntregaPreforma_documentId_idx" ON "EntregaPreforma"("documentId");

-- AddForeignKey
ALTER TABLE "EntregaPreforma" ADD CONSTRAINT "EntregaPreforma_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

