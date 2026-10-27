-- AlterTable
ALTER TABLE "PlanillaDeSueldos" ADD COLUMN     "bonosDe" TEXT,
ADD COLUMN     "feriadosDelMes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "RenglonDeSueldo" ADD COLUMN     "diasDelMes" JSONB;

