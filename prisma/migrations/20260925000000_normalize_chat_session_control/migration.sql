-- isActive indicates whether the AI may answer. Only human handoffs pause it.
ALTER TABLE "chat_sessions" ALTER COLUMN "isActive" SET DEFAULT true;

UPDATE "chat_sessions"
SET "isActive" = CASE
  WHEN "status" = 'ATENDIMENTO_HUMANO' THEN false
  ELSE true
END;
