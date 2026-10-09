-- Plata que entra desde la cuenta de un proveedor: aportes de capital del socio y cobros a
-- proveedores. Antes se cargaban como pagos negativos.

-- CreateEnum
CREATE TYPE "PaymentConcepto" AS ENUM ('APORTE_CAPITAL', 'COBRO_PROVEEDOR');

-- AlterEnum
ALTER TYPE "TreasuryMovementCategory" ADD VALUE 'APORTE_CAPITAL';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "concepto" "PaymentConcepto";
