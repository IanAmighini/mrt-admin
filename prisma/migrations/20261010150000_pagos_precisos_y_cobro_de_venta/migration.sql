-- Los pagos en dólares guardan el número entero (pesos ÷ cotización) y no el redondeado a
-- centavos, para que los pesos de origen se mantengan en todos lados. Y un cobro a un proveedor
-- puede decir qué venta paga.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cobraDocumentoId" TEXT,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(20,8);

-- AlterTable
ALTER TABLE "PaymentAllocation" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(20,8);

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cobraDocumentoId_fkey" FOREIGN KEY ("cobraDocumentoId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
