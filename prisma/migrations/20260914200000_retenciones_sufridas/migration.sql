-- CreateEnum
CREATE TYPE "RetentionKind" AS ENUM ('IVA', 'GANANCIAS', 'IIBB', 'OTRA');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'RETENCION';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "retentionKind" "RetentionKind";

