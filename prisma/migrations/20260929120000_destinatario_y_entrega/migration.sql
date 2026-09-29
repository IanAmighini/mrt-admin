-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "destinatarioId" TEXT,
ADD COLUMN     "entregaId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "entregaId" TEXT;

-- CreateTable
CREATE TABLE "Destinatario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "taxId" TEXT,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Destinatario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entrega" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "destino" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL,
    "notas" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entrega_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Destinatario_entityId_idx" ON "Destinatario"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Destinatario_entityId_nombre_key" ON "Destinatario"("entityId", "nombre");

-- CreateIndex
CREATE INDEX "Entrega_entityId_idx" ON "Entrega"("entityId");

-- CreateIndex
CREATE INDEX "Document_destinatarioId_idx" ON "Document"("destinatarioId");

-- CreateIndex
CREATE INDEX "Document_entregaId_idx" ON "Document"("entregaId");

-- CreateIndex
CREATE INDEX "Payment_entregaId_idx" ON "Payment"("entregaId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_destinatarioId_fkey" FOREIGN KEY ("destinatarioId") REFERENCES "Destinatario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_entregaId_fkey" FOREIGN KEY ("entregaId") REFERENCES "Entrega"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_entregaId_fkey" FOREIGN KEY ("entregaId") REFERENCES "Entrega"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Destinatario" ADD CONSTRAINT "Destinatario_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entrega" ADD CONSTRAINT "Entrega_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entrega" ADD CONSTRAINT "Entrega_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

