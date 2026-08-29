CREATE TYPE "public"."agentConversationSource" AS ENUM('telegram', 'web');--> statement-breakpoint
CREATE TABLE "agent" (
	"agentId" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Dokploy Agent' NOT NULL,
	"instructions" text,
	"isEnabled" boolean DEFAULT false NOT NULL,
	"aiId" text,
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"telegramEnabled" boolean DEFAULT false NOT NULL,
	"telegramBotToken" text,
	"telegramAllowedUserIds" text,
	"createdAt" text NOT NULL,
	CONSTRAINT "agent_organizationId_unique" UNIQUE("organizationId")
);
--> statement-breakpoint
CREATE TABLE "agent_conversation" (
	"conversationId" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"source" "agentConversationSource" NOT NULL,
	"externalChatId" text,
	"title" text,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_message" (
	"messageId" text PRIMARY KEY NOT NULL,
	"conversationId" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"toolCalls" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_aiId_ai_aiId_fk" FOREIGN KEY ("aiId") REFERENCES "public"."ai"("aiId") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD CONSTRAINT "agent_conversation_agentId_agent_agentId_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("agentId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_conversationId_agent_conversation_conversationId_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."agent_conversation"("conversationId") ON DELETE cascade ON UPDATE no action;