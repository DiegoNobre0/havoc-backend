/*
  Warnings:

  - Added the required column `customerName` to the `orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `customerPhone` to the `orders` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ChatSessionStatus" AS ENUM ('NOVO_ATENDIMENTO', 'EM_ANDAMENTO', 'AGUARDANDO_PAGAMENTO', 'ATENDIMENTO_HUMANO', 'FINALIZADO', 'CANCELADO');

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_userId_fkey";

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "handoffRequestedAt" TIMESTAMP(3),
ADD COLUMN     "recoveryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "ChatSessionStatus" NOT NULL DEFAULT 'NOVO_ATENDIMENTO',
ALTER COLUMN "isActive" SET DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customerCpf" TEXT,
ADD COLUMN     "customerName" TEXT NOT NULL,
ADD COLUMN     "customerPhone" TEXT NOT NULL,
ADD COLUMN     "deliveryAddress" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "orders_customerPhone_idx" ON "orders"("customerPhone");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
