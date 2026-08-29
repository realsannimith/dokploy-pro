import { relations } from "drizzle-orm";
import { boolean, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { ai } from "./ai";
import { user } from "./user";

export const agent = pgTable("agent", {
	agentId: text("agentId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull().default("Dokploy Agent"),
	instructions: text("instructions"),
	isEnabled: boolean("isEnabled").notNull().default(false),
	aiId: text("aiId").references(() => ai.aiId, { onDelete: "set null" }),
	// The user the agent acts as: tool calls run through the same tRPC
	// procedures the dashboard uses, authorized as this user.
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	organizationId: text("organizationId")
		.notNull()
		.unique()
		.references(() => organization.id, { onDelete: "cascade" }),
	telegramEnabled: boolean("telegramEnabled").notNull().default(false),
	telegramBotToken: text("telegramBotToken"),
	// Comma-separated Telegram user IDs allowed to talk to the bot.
	telegramAllowedUserIds: text("telegramAllowedUserIds"),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const agentConversationSource = pgEnum("agentConversationSource", [
	"telegram",
	"web",
]);

export const agentConversation = pgTable("agent_conversation", {
	conversationId: text("conversationId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	agentId: text("agentId")
		.notNull()
		.references(() => agent.agentId, { onDelete: "cascade" }),
	source: agentConversationSource("source").notNull(),
	// Telegram chat id (one conversation per chat) — null for web chats.
	externalChatId: text("externalChatId"),
	title: text("title"),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text("updatedAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export interface AgentToolCall {
	toolName: string;
	input: unknown;
	output?: string;
	isError?: boolean;
}

export const agentMessage = pgTable("agent_message", {
	messageId: text("messageId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	conversationId: text("conversationId")
		.notNull()
		.references(() => agentConversation.conversationId, {
			onDelete: "cascade",
		}),
	role: text("role").$type<"user" | "assistant">().notNull(),
	content: text("content").notNull(),
	toolCalls: text("toolCalls").$type<string | null>(),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const agentRelations = relations(agent, ({ one, many }) => ({
	organization: one(organization, {
		fields: [agent.organizationId],
		references: [organization.id],
	}),
	ai: one(ai, {
		fields: [agent.aiId],
		references: [ai.aiId],
	}),
	user: one(user, {
		fields: [agent.userId],
		references: [user.id],
	}),
	conversations: many(agentConversation),
}));

export const agentConversationRelations = relations(
	agentConversation,
	({ one, many }) => ({
		agent: one(agent, {
			fields: [agentConversation.agentId],
			references: [agent.agentId],
		}),
		messages: many(agentMessage),
	}),
);

export const agentMessageRelations = relations(agentMessage, ({ one }) => ({
	conversation: one(agentConversation, {
		fields: [agentMessage.conversationId],
		references: [agentConversation.conversationId],
	}),
}));

const createSchema = createInsertSchema(agent, {
	name: z.string().min(1, { message: "Name is required" }),
});

export const apiSaveAgent = createSchema
	.pick({
		name: true,
		instructions: true,
		isEnabled: true,
		aiId: true,
		telegramEnabled: true,
		telegramBotToken: true,
		telegramAllowedUserIds: true,
	})
	.partial()
	.extend({
		name: z.string().min(1, { message: "Name is required" }),
	});

export const apiAgentChat = z.object({
	message: z.string().min(1, { message: "Message is required" }),
	conversationId: z.string().optional(),
});
