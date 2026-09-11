-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FLETE', 'ALQUILER', 'SERVICIOS', 'REPARACIONES', 'FERRETERIA', 'COMBUSTIBLE', 'IMPUESTOS', 'HONORARIOS', 'SEGUROS', 'FUMIGACION', 'OTRO');

-- CreateEnum
CREATE TYPE "TaxKind" AS ENUM ('IVA', 'NO_GRAVADO', 'EXENTO', 'PERCEPCION_IVA', 'PERCEPCION_IIBB', 'PERCEPCION_MUNICIPAL', 'IMPUESTO_INTERNO', 'OTRO_TRIBUTO');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'GASTO';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "expenseCategory" "ExpenseCategory";

-- CreateTable
CREATE TABLE "DocumentTax" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "kind" "TaxKind" NOT NULL,
    "base" DECIMAL(14,2),
    "rate" DECIMAL(5,2),
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "DocumentTax_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentTax_documentId_idx" ON "DocumentTax"("documentId");

-- AddForeignKey
ALTER TABLE "DocumentTax" ADD CONSTRAINT "DocumentTax_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

