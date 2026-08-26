-- CreateEnum
CREATE TYPE "SupplierCategory" AS ENUM ('ACEITE', 'ENVASES', 'CAJAS', 'TAPAS', 'CINTA', 'ETIQUETAS', 'PALLET_NORMALIZADO', 'OTRO');

-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "supplierCategory" "SupplierCategory";
