-- Las imputaciones de créditos también con ocho decimales: un crédito que completa lo que dejó un
-- pago en dólares redondeado a centavos dejaba el comprobante debiendo fracciones de centavo.

-- AlterTable
ALTER TABLE "CreditAllocation" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(20,8);
