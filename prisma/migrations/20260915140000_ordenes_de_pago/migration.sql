-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "ordenPagoId" TEXT;

-- CreateTable
CREATE TABLE "OrdenPago" (
    "id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "entityId" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrdenPago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrdenPago_numero_key" ON "OrdenPago"("numero");

-- CreateIndex
CREATE INDEX "OrdenPago_entityId_idx" ON "OrdenPago"("entityId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ordenPagoId_fkey" FOREIGN KEY ("ordenPagoId") REFERENCES "OrdenPago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenPago" ADD CONSTRAINT "OrdenPago_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrdenPago" ADD CONSTRAINT "OrdenPago_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

