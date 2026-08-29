ALTER TABLE "agent_conversation" ADD COLUMN "gatewaySessionKey" text;
--> statement-breakpoint
UPDATE "agent_conversation"
SET "gatewaySessionKey" = "externalChatId"
WHERE "externalChatId" IS NOT NULL;
