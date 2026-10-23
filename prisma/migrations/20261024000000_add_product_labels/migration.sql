-- CreateEnum
CREATE TYPE "ProductLabelStatus" AS ENUM ('SOURCE_MATCHED', 'NOT_FOUND', 'FAILED');

-- CreateTable
CREATE TABLE "product_labels" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT,
    "manufacturerDomain" TEXT,
    "sourceUrl" TEXT,
    "sourceTitle" TEXT,
    "sourceRetrievedAt" TIMESTAMP(3),
    "sourceHash" TEXT,
    "servingSize" TEXT,
    "servingsPerContainer" TEXT,
    "usageInstructions" TEXT,
    "ingredients" TEXT,
    "allergenStatement" TEXT,
    "warnings" JSONB,
    "nutritionFacts" JSONB,
    "exactProductMatch" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProductLabelStatus" NOT NULL DEFAULT 'NOT_FOUND',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "productId" TEXT NOT NULL,

    CONSTRAINT "product_labels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_labels_productId_key" ON "product_labels"("productId");
CREATE INDEX "product_labels_status_exactProductMatch_idx" ON "product_labels"("status", "exactProductMatch");

ALTER TABLE "product_labels" ADD CONSTRAINT "product_labels_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
