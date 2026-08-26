/*
  Warnings:

  - You are about to drop the column `contact` on the `Entity` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Entity" DROP COLUMN "contact",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT;
