CREATE TABLE "agent_memory" (
	"memoryId" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"origin" text DEFAULT 'agent' NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_agentId_agent_agentId_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("agentId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memory_agentId_key_index" ON "agent_memory" USING btree ("agentId","key");