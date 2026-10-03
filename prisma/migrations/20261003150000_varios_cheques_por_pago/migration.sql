-- DropIndex
DROP INDEX "Cheque_entregadoEnId_key";

-- CreateIndex
CREATE INDEX "Cheque_entregadoEnId_idx" ON "Cheque"("entregadoEnId");

