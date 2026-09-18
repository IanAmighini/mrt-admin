-- La deuda de preformas sale de los remitos menos las entregas, y las dos cosas arrancan vacías:
-- sin un saldo inicial por tipo, la cuenta nace en cero y no es la que dice la planilla.

-- CreateTable
CREATE TABLE "PreformaSaldoInicial" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "preformaId" TEXT NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreformaSaldoInicial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreformaSaldoInicial_entityId_idx" ON "PreformaSaldoInicial"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "PreformaSaldoInicial_entityId_preformaId_key" ON "PreformaSaldoInicial"("entityId", "preformaId");

-- AddForeignKey
ALTER TABLE "PreformaSaldoInicial" ADD CONSTRAINT "PreformaSaldoInicial_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreformaSaldoInicial" ADD CONSTRAINT "PreformaSaldoInicial_preformaId_fkey" FOREIGN KEY ("preformaId") REFERENCES "Preforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

