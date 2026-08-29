CREATE TYPE "public"."agentChannelType" AS ENUM('telegram', 'discord', 'slack', 'whatsapp', 'signal', 'email');--> statement-breakpoint
ALTER TYPE "public"."agentConversationSource" ADD VALUE 'discord' BEFORE 'web';--> statement-breakpoint
ALTER TYPE "public"."agentConversationSource" ADD VALUE 'slack' BEFORE 'web';--> statement-breakpoint
ALTER TYPE "public"."agentConversationSource" ADD VALUE 'whatsapp' BEFORE 'web';--> statement-breakpoint
ALTER TYPE "public"."agentConversationSource" ADD VALUE 'signal' BEFORE 'web';--> statement-breakpoint
ALTER TYPE "public"."agentConversationSource" ADD VALUE 'email' BEFORE 'web';--> statement-breakpoint
CREATE TABLE "agent_channel" (
	"channelId" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"type" "agentChannelType" NOT NULL,
	"isEnabled" boolean DEFAULT false NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowedIdentifiers" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "agent_channel" ADD CONSTRAINT "agent_channel_agentId_agent_agentId_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("agentId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Carry existing Telegram config over to the per-channel table
INSERT INTO "agent_channel" ("channelId", "agentId", "type", "isEnabled", "credentials", "allowedIdentifiers", "createdAt")
SELECT
	gen_random_uuid()::text,
	"agentId",
	'telegram',
	COALESCE("telegramEnabled", false),
	jsonb_build_object('botToken', COALESCE("telegramBotToken", '')),
	"telegramAllowedUserIds",
	now()::text
FROM "agent"
WHERE "telegramBotToken" IS NOT NULL AND "telegramBotToken" <> '';
