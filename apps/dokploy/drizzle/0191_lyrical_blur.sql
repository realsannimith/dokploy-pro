CREATE TABLE "agent_skill" (
	"skillId" text PRIMARY KEY NOT NULL,
	"agentId" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"content" text NOT NULL,
	"origin" text DEFAULT 'agent' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"usageCount" integer DEFAULT 0 NOT NULL,
	"createdAt" text NOT NULL,
	"updatedAt" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_skill" ADD CONSTRAINT "agent_skill_agentId_agent_agentId_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("agentId") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skill_agentId_name_index" ON "agent_skill" USING btree ("agentId","name");