/*
  Warnings:

  - Added the required column `amount` to the `DocumentLink` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "DocumentLink" ADD COLUMN     "amount" DECIMAL(14,2) NOT NULL;
