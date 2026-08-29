CREATE TABLE "agent_pending_action" (
	"actionId" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"conversationId" text NOT NULL,
	"channelId" text,
	"externalChatId" text,
	"toolName" text NOT NULL,
	"toolInput" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "toolConfig" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "mcpConfig" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_pending_action" ADD CONSTRAINT "agent_pending_action_agentId_agent_agentId_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("agentId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pending_action" ADD CONSTRAINT "agent_pending_action_conversationId_agent_conversation_conversationId_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."agent_conversation"("conversationId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pending_action" ADD CONSTRAINT "agent_pending_action_channelId_agent_channel_channelId_fk" FOREIGN KEY ("channelId") REFERENCES "public"."agent_channel"("channelId") ON DELETE cascade ON UPDATE no action;