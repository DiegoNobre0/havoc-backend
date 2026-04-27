/*
  Warnings:

  - You are about to drop the column `categoryId` on the `products` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "products_categoryId_idx";

-- AlterTable
ALTER TABLE "products" DROP COLUMN "categoryId";
