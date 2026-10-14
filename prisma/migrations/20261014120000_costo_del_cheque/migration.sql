-- Lo que cuesta tomar un cheque, en %. El cobro va por lo neto; el cheque guarda lo que dice el papel.

-- AlterTable
ALTER TABLE "Cheque" ADD COLUMN     "costoPct" DECIMAL(6,3);
