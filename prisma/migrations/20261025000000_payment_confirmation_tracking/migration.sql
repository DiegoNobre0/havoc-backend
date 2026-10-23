CREATE TYPE "CheckoutPaymentMethod" AS ENUM ('PIX', 'CREDIT_CARD', 'CASH');
CREATE TYPE "DeliveryMethod" AS ENUM ('DELIVERY', 'PICKUP');
CREATE TYPE "PaymentEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');
CREATE TYPE "PaymentNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "orders"
ADD COLUMN "deliveryMethod" "DeliveryMethod",
ADD COLUMN "paymentMethod" "CheckoutPaymentMethod";

ALTER TABLE "payments"
ADD COLUMN "providerStatus" TEXT,
ADD COLUMN "statusDetail" TEXT,
ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "PaymentEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "paymentId" TEXT,
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_notifications" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" "PaymentNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paymentId" TEXT NOT NULL,
    CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_events_deduplicationKey_key" ON "payment_events"("deduplicationKey");
CREATE INDEX "payment_events_providerPaymentId_idx" ON "payment_events"("providerPaymentId");
CREATE INDEX "payment_events_status_idx" ON "payment_events"("status");
CREATE INDEX "payment_events_receivedAt_idx" ON "payment_events"("receivedAt");
CREATE UNIQUE INDEX "payment_notifications_paymentId_type_channel_key" ON "payment_notifications"("paymentId", "type", "channel");
CREATE INDEX "payment_notifications_status_idx" ON "payment_notifications"("status");
CREATE INDEX "payment_notifications_createdAt_idx" ON "payment_notifications"("createdAt");

ALTER TABLE "payment_events"
ADD CONSTRAINT "payment_events_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_notifications"
ADD CONSTRAINT "payment_notifications_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
