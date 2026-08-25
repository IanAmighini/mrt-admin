-- CreateEnum
CREATE TYPE "BoxMovementType" AS ENUM ('ARMADO', 'CONSUMO_PALLET', 'DEVUELTO_PALLET', 'AJUSTE', 'MERMA');

-- CreateEnum
CREATE TYPE "PalletStatus" AS ENUM ('ARMADO', 'DESARMADO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ItemMovementType" ADD VALUE 'CONSUMO_PALLET';
ALTER TYPE "ItemMovementType" ADD VALUE 'VENTA';

-- AlterEnum
ALTER TYPE "ProductMovementType" ADD VALUE 'CONSUMO_ARMADO_CAJA';

-- CreateTable
CREATE TABLE "BoxType" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitsPerBox" DECIMAL(14,3) NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoxType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoxMovement" (
    "id" TEXT NOT NULL,
    "boxTypeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "type" "BoxMovementType" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoxMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pallet" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "woodItemId" TEXT NOT NULL,
    "filmItemId" TEXT NOT NULL,
    "filmQuantity" DECIMAL(14,3) NOT NULL,
    "status" "PalletStatus" NOT NULL DEFAULT 'ARMADO',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismantledAt" TIMESTAMP(3),

    CONSTRAINT "Pallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PalletBox" (
    "id" TEXT NOT NULL,
    "palletId" TEXT NOT NULL,
    "boxTypeId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "PalletBox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoxMovement_boxTypeId_idx" ON "BoxMovement"("boxTypeId");

-- AddForeignKey
ALTER TABLE "BoxType" ADD CONSTRAINT "BoxType_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoxMovement" ADD CONSTRAINT "BoxMovement_boxTypeId_fkey" FOREIGN KEY ("boxTypeId") REFERENCES "BoxType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoxMovement" ADD CONSTRAINT "BoxMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pallet" ADD CONSTRAINT "Pallet_woodItemId_fkey" FOREIGN KEY ("woodItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pallet" ADD CONSTRAINT "Pallet_filmItemId_fkey" FOREIGN KEY ("filmItemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pallet" ADD CONSTRAINT "Pallet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletBox" ADD CONSTRAINT "PalletBox_palletId_fkey" FOREIGN KEY ("palletId") REFERENCES "Pallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PalletBox" ADD CONSTRAINT "PalletBox_boxTypeId_fkey" FOREIGN KEY ("boxTypeId") REFERENCES "BoxType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
