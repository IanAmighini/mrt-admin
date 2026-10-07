-- DropForeignKey
ALTER TABLE "Transferencia" DROP CONSTRAINT "Transferencia_paymentId_fkey";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "numeroOperacion" TEXT;

-- DropTable
DROP TABLE "Transferencia";

