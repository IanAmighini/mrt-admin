-- AlterTable
ALTER TABLE "RenglonDeSueldo" ADD COLUMN     "monotributo" DECIMAL(14,2),
ADD COLUMN     "presentismo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "puntualidad" BOOLEAN NOT NULL DEFAULT false;

