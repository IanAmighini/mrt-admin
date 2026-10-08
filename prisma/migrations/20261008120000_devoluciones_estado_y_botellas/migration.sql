-- CreateEnum
CREATE TYPE "EstadoDevolucion" AS ENUM ('SANO', 'CON_ROTURAS', 'NO_SIRVE');

-- AlterEnum
ALTER TYPE "ProductionLineTipo" ADD VALUE 'CAJAS_DE_BOTELLAS';

-- AlterTable
ALTER TABLE "CajaMovement" ADD COLUMN     "botellas" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DocumentLine" ADD COLUMN     "botellas" INTEGER,
ADD COLUMN     "botellasSanas" INTEGER,
ADD COLUMN     "cajasRotas" INTEGER,
ADD COLUMN     "estadoDevolucion" "EstadoDevolucion",
ADD COLUMN     "palletsRearmados" BOOLEAN;
