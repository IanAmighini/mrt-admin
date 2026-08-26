-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "bottleCapacityMl" DECIMAL(10,2),
ADD COLUMN     "boxesPerPallet" INTEGER,
ADD COLUMN     "unitsPerBox" INTEGER;

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);
