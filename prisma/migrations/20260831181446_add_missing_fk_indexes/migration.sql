-- CreateIndex
CREATE INDEX "DocumentLine_productId_idx" ON "DocumentLine"("productId");

-- CreateIndex
CREATE INDEX "DocumentLink_facturaId_idx" ON "DocumentLink"("facturaId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_documentId_idx" ON "PaymentAllocation"("documentId");

-- CreateIndex
CREATE INDEX "PedidoLine_productId_idx" ON "PedidoLine"("productId");

-- CreateIndex
CREATE INDEX "ProductionLine_productionRunId_idx" ON "ProductionLine"("productionRunId");

-- CreateIndex
CREATE INDEX "ProductionLine_productId_idx" ON "ProductionLine"("productId");

-- CreateIndex
CREATE INDEX "PurchaseLine_itemId_idx" ON "PurchaseLine"("itemId");
