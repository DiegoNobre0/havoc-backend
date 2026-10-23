CREATE TYPE "StorefrontConsultantMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "storefront_consultant_sessions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_consultant_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "storefront_consultant_messages" (
    "id" TEXT NOT NULL,
    "role" "StorefrontConsultantMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "context" JSONB,
    "recommendations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,

    CONSTRAINT "storefront_consultant_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storefront_consultant_sessions_tokenHash_key" ON "storefront_consultant_sessions"("tokenHash");
CREATE INDEX "storefront_consultant_sessions_clientId_idx" ON "storefront_consultant_sessions"("clientId");
CREATE INDEX "storefront_consultant_sessions_expiresAt_idx" ON "storefront_consultant_sessions"("expiresAt");
CREATE UNIQUE INDEX "storefront_consultant_messages_sessionId_requestId_role_key" ON "storefront_consultant_messages"("sessionId", "requestId", "role");
CREATE INDEX "storefront_consultant_messages_sessionId_createdAt_idx" ON "storefront_consultant_messages"("sessionId", "createdAt");

ALTER TABLE "storefront_consultant_messages"
ADD CONSTRAINT "storefront_consultant_messages_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "storefront_consultant_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
