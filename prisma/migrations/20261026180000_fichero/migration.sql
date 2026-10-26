-- AlterTable
ALTER TABLE "Entity" ADD COLUMN     "idFichero" TEXT;

-- AlterTable
ALTER TABLE "PlanillaDeSueldos" ADD COLUMN     "feriados" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "RenglonDeSueldo" ADD COLUMN     "dias" JSONB;

