-- AlterTable
ALTER TABLE "products" ADD COLUMN     "cfop" TEXT,
ADD COLUMN     "cost_price" DECIMAL(10,2),
ADD COLUMN     "ncm" TEXT,
ADD COLUMN     "price_wholesale" DECIMAL(10,2),
ADD COLUMN     "stock_min" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'UN';
