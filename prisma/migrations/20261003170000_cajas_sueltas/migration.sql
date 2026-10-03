-- CreateEnum
CREATE TYPE "CajaMovementType" AS ENUM ('PRODUCCION', 'ENTREGA', 'ARMADO', 'DESARMADO', 'DEVOLUCION', 'AJUSTE', 'MERMA');

-- CreateEnum
CREATE TYPE "ProductionLineTipo" AS ENUM ('PALLETS', 'CAJAS', 'ARMADO', 'DESARMADO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProductMovementType" ADD VALUE 'ARMADO';
ALTER TYPE "ProductMovementType" ADD VALUE 'DESARMADO';
ALTER TYPE "ProductMovementType" ADD VALUE 'DEVOLUCION';

-- AlterTable
ALTER TABLE "DocumentLine" ADD COLUMN     "cajas" INTEGER,
ADD COLUMN     "pallets" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "cajaId" TEXT;

-- AlterTable
ALTER TABLE "ProductionLine" ADD COLUMN     "tipo" "ProductionLineTipo" NOT NULL DEFAULT 'PALLETS';

-- CreateTable
CREATE TABLE "Caja" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "oilType" TEXT NOT NULL,
    "bottleCapacityMl" DECIMAL(10,2) NOT NULL,
    "unitsPerBox" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CajaMovement" (
    "id" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "type" "CajaMovementType" NOT NULL,
    "reason" TEXT NOT NULL,
    "productionLineId" TEXT,
    "documentLineId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CajaMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Caja_name_oilType_bottleCapacityMl_unitsPerBox_key" ON "Caja"("name", "oilType", "bottleCapacityMl", "unitsPerBox");

-- CreateIndex
CREATE INDEX "CajaMovement_cajaId_idx" ON "CajaMovement"("cajaId");

-- CreateIndex
CREATE INDEX "CajaMovement_productionLineId_idx" ON "CajaMovement"("productionLineId");

-- CreateIndex
CREATE INDEX "CajaMovement_documentLineId_idx" ON "CajaMovement"("documentLineId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaMovement" ADD CONSTRAINT "CajaMovement_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaMovement" ADD CONSTRAINT "CajaMovement_productionLineId_fkey" FOREIGN KEY ("productionLineId") REFERENCES "ProductionLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaMovement" ADD CONSTRAINT "CajaMovement_documentLineId_fkey" FOREIGN KEY ("documentLineId") REFERENCES "DocumentLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CajaMovement" ADD CONSTRAINT "CajaMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Las cajas de los productos que ya existen: una por marca + aceite + ml + botellas por caja, y cada
-- producto apuntando a la suya. Los productos sin ml o sin botellas por caja quedan sin caja; los que
-- se creen de acá en adelante la consiguen al usarse (ver `cajaDelProducto`).
INSERT INTO "Caja" ("id", "name", "oilType", "bottleCapacityMl", "unitsPerBox")
SELECT 'caja_' || md5(p."name" || '|' || p."oilType" || '|' || p."bottleCapacityMl"::text || '|' || p."unitsPerBox"::text),
       p."name", p."oilType", p."bottleCapacityMl", p."unitsPerBox"
FROM "Product" p
WHERE p."bottleCapacityMl" IS NOT NULL AND p."unitsPerBox" IS NOT NULL
GROUP BY p."name", p."oilType", p."bottleCapacityMl", p."unitsPerBox";

UPDATE "Product" p
SET "cajaId" = c."id"
FROM "Caja" c
WHERE c."name" = p."name"
  AND c."oilType" = p."oilType"
  AND c."bottleCapacityMl" = p."bottleCapacityMl"
  AND c."unitsPerBox" = p."unitsPerBox";
