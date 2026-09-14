-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaxKind" ADD VALUE 'PERCEPCION_IIBB_BSAS';
ALTER TYPE "TaxKind" ADD VALUE 'PERCEPCION_IIBB_CABA';
ALTER TYPE "TaxKind" ADD VALUE 'PERCEPCION_IIBB_SANTA_FE';
ALTER TYPE "TaxKind" ADD VALUE 'CONTRIBUCION_MUNICIPAL';
ALTER TYPE "TaxKind" ADD VALUE 'CONTRIBUCION_PROVINCIAL';
ALTER TYPE "TaxKind" ADD VALUE 'RG_3337';
ALTER TYPE "TaxKind" ADD VALUE 'CEF';

-- AlterTable
ALTER TABLE "DocumentTax" ADD COLUMN     "description" TEXT;

