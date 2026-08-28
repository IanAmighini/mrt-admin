-- CreateTable
CREATE TABLE "Marca" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "oilType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Marca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Formato" (
    "id" TEXT NOT NULL,
    "presentation" TEXT NOT NULL,
    "boxesPerPallet" INTEGER NOT NULL,
    "unitsPerBox" INTEGER NOT NULL,
    "bottleCapacityMl" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Formato_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Marca_name_oilType_key" ON "Marca"("name", "oilType");

-- CreateIndex
CREATE UNIQUE INDEX "Formato_presentation_key" ON "Formato"("presentation");
