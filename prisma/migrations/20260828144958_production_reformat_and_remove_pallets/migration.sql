/*
  Warnings:

  - You are about to drop the `BoxMovement` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BoxType` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Pallet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PalletBox` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BoxMovement" DROP CONSTRAINT "BoxMovement_boxTypeId_fkey";

-- DropForeignKey
ALTER TABLE "BoxMovement" DROP CONSTRAINT "BoxMovement_createdById_fkey";

-- DropForeignKey
ALTER TABLE "BoxType" DROP CONSTRAINT "BoxType_productId_fkey";

-- DropForeignKey
ALTER TABLE "Pallet" DROP CONSTRAINT "Pallet_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Pallet" DROP CONSTRAINT "Pallet_filmItemId_fkey";

-- DropForeignKey
ALTER TABLE "Pallet" DROP CONSTRAINT "Pallet_woodItemId_fkey";

-- DropForeignKey
ALTER TABLE "PalletBox" DROP CONSTRAINT "PalletBox_boxTypeId_fkey";

-- DropForeignKey
ALTER TABLE "PalletBox" DROP CONSTRAINT "PalletBox_palletId_fkey";

-- AlterTable
ALTER TABLE "ItemMovement" ADD COLUMN     "productionLineId" TEXT;

-- AlterTable
ALTER TABLE "ProductMovement" ADD COLUMN     "productionLineId" TEXT;

-- AlterTable
ALTER TABLE "ProductionRun" ADD COLUMN     "notes" TEXT;

-- DropTable
DROP TABLE "BoxMovement";

-- DropTable
DROP TABLE "BoxType";

-- DropTable
DROP TABLE "Pallet";

-- DropTable
DROP TABLE "PalletBox";

-- DropEnum
DROP TYPE "BoxMovementType";

-- DropEnum
DROP TYPE "PalletStatus";

-- CreateIndex
CREATE INDEX "ItemMovement_productionLineId_idx" ON "ItemMovement"("productionLineId");

-- CreateIndex
CREATE INDEX "ProductMovement_productionLineId_idx" ON "ProductMovement"("productionLineId");

-- AddForeignKey
ALTER TABLE "ItemMovement" ADD CONSTRAINT "ItemMovement_productionLineId_fkey" FOREIGN KEY ("productionLineId") REFERENCES "ProductionLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMovement" ADD CONSTRAINT "ProductMovement_productionLineId_fkey" FOREIGN KEY ("productionLineId") REFERENCES "ProductionLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
