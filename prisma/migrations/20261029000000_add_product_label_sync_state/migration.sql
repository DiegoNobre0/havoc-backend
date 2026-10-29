ALTER TYPE "ProductLabelStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "ProductLabelStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "product_labels"
ADD COLUMN "evidence" JSONB,
ADD COLUMN "identityHash" TEXT,
ADD COLUMN "syncAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastSyncAttemptAt" TIMESTAMP(3),
ADD COLUMN "nextSyncAt" TIMESTAMP(3),
ADD COLUMN "lastSyncErrorCode" TEXT;

CREATE INDEX "product_labels_nextSyncAt_idx" ON "product_labels"("nextSyncAt");

UPDATE "product_labels"
SET "nextSyncAt" = CURRENT_TIMESTAMP
WHERE "nextSyncAt" IS NULL;
