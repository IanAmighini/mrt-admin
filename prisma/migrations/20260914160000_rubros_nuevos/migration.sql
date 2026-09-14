-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ExpenseCategory" ADD VALUE 'HIGIENE_Y_SEGURIDAD';
ALTER TYPE "ExpenseCategory" ADD VALUE 'BALANZA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SupplierCategory" ADD VALUE 'PREFORMAS';
ALTER TYPE "SupplierCategory" ADD VALUE 'ADITIVO_TINTA';
ALTER TYPE "SupplierCategory" ADD VALUE 'JABON';

