-- CreateTable
CREATE TABLE "Transferencia" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "numeroOperacion" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "Transferencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transferencia_paymentId_idx" ON "Transferencia"("paymentId");

-- AddForeignKey
ALTER TABLE "Transferencia" ADD CONSTRAINT "Transferencia_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

