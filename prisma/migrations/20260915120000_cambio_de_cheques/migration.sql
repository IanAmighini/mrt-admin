-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN     "cambiadoA" TEXT,
ADD COLUMN     "cambioEnId" TEXT;

-- CreateIndex
CREATE INDEX "Cheque_cambioEnId_idx" ON "Cheque"("cambioEnId");

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_cambioEnId_fkey" FOREIGN KEY ("cambioEnId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

