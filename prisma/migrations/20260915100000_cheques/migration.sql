-- CreateEnum
CREATE TYPE "ChequeEstado" AS ENUM ('EN_CARTERA', 'ENTREGADO', 'DEPOSITADO', 'RECHAZADO');

-- CreateTable
CREATE TABLE "Cheque" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "banco" TEXT,
    "esEcheq" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(14,2) NOT NULL,
    "fechaCobro" TIMESTAMP(3),
    "estado" "ChequeEstado" NOT NULL DEFAULT 'EN_CARTERA',
    "recibidoEnId" TEXT,
    "entregadoEnId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_recibidoEnId_key" ON "Cheque"("recibidoEnId");

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_entregadoEnId_key" ON "Cheque"("entregadoEnId");

-- CreateIndex
CREATE INDEX "Cheque_estado_idx" ON "Cheque"("estado");

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_recibidoEnId_fkey" FOREIGN KEY ("recibidoEnId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_entregadoEnId_fkey" FOREIGN KEY ("entregadoEnId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

