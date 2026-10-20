-- CreateEnum
CREATE TYPE "FormaDeSueldo" AS ENUM ('SEMANAL', 'MENSUAL');

-- CreateEnum
CREATE TYPE "EstadoPlanilla" AS ENUM ('BORRADOR', 'CERRADA');

-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "empleadoBaja" TIMESTAMP(3),
ADD COLUMN     "formaDeSueldo" "FormaDeSueldo";

-- CreateTable
CREATE TABLE "TarifaDeEmpleado" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "desde" TIMESTAMP(3) NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TarifaDeEmpleado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanillaDeSueldos" (
    "id" TEXT NOT NULL,
    "forma" "FormaDeSueldo" NOT NULL,
    "desde" TIMESTAMP(3) NOT NULL,
    "hasta" TIMESTAMP(3) NOT NULL,
    "fechaDePago" TIMESTAMP(3) NOT NULL,
    "cajaId" TEXT,
    "estado" "EstadoPlanilla" NOT NULL DEFAULT 'BORRADOR',
    "notas" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cerradaAt" TIMESTAMP(3),

    CONSTRAINT "PlanillaDeSueldos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenglonDeSueldo" (
    "id" TEXT NOT NULL,
    "planillaId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "tarifa" DECIMAL(14,2),
    "horas" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "horasFeriado" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "descuentoCuenta1" DECIMAL(14,2),
    "descuentoACuenta" DECIMAL(14,2),
    "pagado" DECIMAL(14,2),
    "saldoAnterior" DECIMAL(14,2),
    "comentario" TEXT,
    "gastoId" TEXT,
    "pagoId" TEXT,

    CONSTRAINT "RenglonDeSueldo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TarifaDeEmpleado_entityId_desde_idx" ON "TarifaDeEmpleado"("entityId", "desde");

-- CreateIndex
CREATE INDEX "PlanillaDeSueldos_desde_idx" ON "PlanillaDeSueldos"("desde");

-- CreateIndex
CREATE UNIQUE INDEX "RenglonDeSueldo_gastoId_key" ON "RenglonDeSueldo"("gastoId");

-- CreateIndex
CREATE UNIQUE INDEX "RenglonDeSueldo_pagoId_key" ON "RenglonDeSueldo"("pagoId");

-- CreateIndex
CREATE INDEX "RenglonDeSueldo_entityId_idx" ON "RenglonDeSueldo"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "RenglonDeSueldo_planillaId_entityId_key" ON "RenglonDeSueldo"("planillaId", "entityId");

-- AddForeignKey
ALTER TABLE "TarifaDeEmpleado" ADD CONSTRAINT "TarifaDeEmpleado_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TarifaDeEmpleado" ADD CONSTRAINT "TarifaDeEmpleado_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanillaDeSueldos" ADD CONSTRAINT "PlanillaDeSueldos_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenglonDeSueldo" ADD CONSTRAINT "RenglonDeSueldo_planillaId_fkey" FOREIGN KEY ("planillaId") REFERENCES "PlanillaDeSueldos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenglonDeSueldo" ADD CONSTRAINT "RenglonDeSueldo_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenglonDeSueldo" ADD CONSTRAINT "RenglonDeSueldo_gastoId_fkey" FOREIGN KEY ("gastoId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenglonDeSueldo" ADD CONSTRAINT "RenglonDeSueldo_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

