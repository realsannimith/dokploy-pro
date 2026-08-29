import { relations } from "drizzle-orm";
import { boolean, jsonb, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { ai } from "./ai";
import { user } from "./user";

export interface AgentToolSetting {
	enabled?: boolean;
	confirm?: boolean;
}

/** Per-tool overrides; a missing entry means the tool's defaults apply. */
export type AgentToolConfig = Record<string, AgentToolSetting>;

export interface AgentMcpConfig {
	enabled?: boolean;
	mode?: "full" | "read-only" | "custom";
	/** Routers (tRPC namespaces) hidden from MCP when mode is "custom". */
	disabledRouters?: string[];
}

export const agent = pgTable("agent", {
	agentId: text("agentId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	name: text("name").notNull().default("Dokploy Agent"),
	instructions: text("instructions"),
	isEnabled: boolean("isEnabled").notNull().default(false),
	aiId: text("aiId").references(() => ai.aiId, { onDelete: "set null" }),
	// Overrides the model configured on the AI provider when set.
	model: text("model"),
	// The user the agent acts as: tool calls run through the same tRPC
	// procedures the dashboard uses, authorized as this user.
	userId: text("userId")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	organizationId: text("organizationId")
		.notNull()
		.unique()
		.references(() => organization.id, { onDelete: "cascade" }),
	toolConfig: jsonb("toolConfig")
		.$type<AgentToolConfig>()
		.notNull()
		.default({}),
	mcpConfig: jsonb("mcpConfig").$type<AgentMcpConfig>().notNull().default({}),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const agentChannelType = pgEnum("agentChannelType", [
	"telegram",
	"discord",
	"slack",
	"whatsapp",
	"signal",
	"email",
]);

export const agentConversationSource = pgEnum("agentConversationSource", [
	"telegram",
	"discord",
	"slack",
	"whatsapp",
	"signal",
	"email",
	"web",
]);

export interface AgentChannelCredentials {
	/** telegram + discord */
	botToken?: string;
	/** slack: app-level token (xapp-) used for Socket Mode */
	appToken?: string;
	/** whatsapp cloud api */
	accessToken?: string;
	phoneNumberId?: string;
	verifyToken?: string;
	/** signal-cli-rest-api */
	apiUrl?: string;
	number?: string;
	/** email */
	imapHost?: string;
	imapPort?: number;
	imapUser?: string;
	imapPassword?: string;
	smtpHost?: string;
	smtpPort?: number;
	smtpSecure?: boolean;
	smtpUser?: string;
	smtpPassword?: string;
	fromAddress?: string;
}

export const agentChannel = pgTable("agent_channel", {
	channelId: text("channelId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	agentId: text("agentId")
		.notNull()
		.references(() => agent.agentId, { onDelete: "cascade" }),
	type: agentChannelType("type").notNull(),
	isEnabled: boolean("isEnabled").notNull().default(false),
	credentials: jsonb("credentials")
		.$type<AgentChannelCredentials>()
		.notNull()
		.default({}),
	/** Comma-separated user ids/usernames/emails allowed to talk to the agent. */
	allowedIdentifiers: text("allowedIdentifiers"),
	createdAt: text("createdAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

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

export const agentPendingAction = pgTable("agent_pending_action", {
	actionId: text("actionId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	agentId: text("agentId")
		.notNull()
		.references(() => agent.agentId, { onDelete: "cascade" }),
	conversationId: text("conversationId")
		.notNull()
		.references(() => agentConversation.conversationId, {
			onDelete: "cascade",
		}),
	channelId: text("channelId").references(() => agentChannel.channelId, {
		onDelete: "cascade",
	}),
	/** Chat the confirmation buttons were sent to, to verify the click origin. */
	externalChatId: text("externalChatId"),
	toolName: text("toolName").notNull(),
	toolInput: jsonb("toolInput").notNull().default({}),
	summary: text("summary").notNull(),
	status: text("status")
		.$type<"pending" | "approved" | "rejected" | "expired">()
		.notNull()
		.default("pending"),
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
	channels: many(agentChannel),
}));

export const agentChannelRelations = relations(agentChannel, ({ one }) => ({
	agent: one(agent, {
		fields: [agentChannel.agentId],
		references: [agent.agentId],
	}),
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
		model: true,
	})
	.partial()
	.extend({
		name: z.string().min(1, { message: "Name is required" }),
	});

export const agentChannelTypeSchema = z.enum([
	"telegram",
	"discord",
	"slack",
	"whatsapp",
	"signal",
	"email",
]);

export const agentChannelCredentialsSchema = z.object({
	botToken: z.string().optional(),
	appToken: z.string().optional(),
	accessToken: z.string().optional(),
	phoneNumberId: z.string().optional(),
	verifyToken: z.string().optional(),
	apiUrl: z.string().optional(),
	number: z.string().optional(),
	imapHost: z.string().optional(),
	imapPort: z.number().optional(),
	imapUser: z.string().optional(),
	imapPassword: z.string().optional(),
	smtpHost: z.string().optional(),
	smtpPort: z.number().optional(),
	smtpSecure: z.boolean().optional(),
	smtpUser: z.string().optional(),
	smtpPassword: z.string().optional(),
	fromAddress: z.string().optional(),
});

export const apiSaveAgentChannel = z.object({
	channelId: z.string().optional(),
	type: agentChannelTypeSchema,
	isEnabled: z.boolean().default(false),
	credentials: agentChannelCredentialsSchema.default({}),
	allowedIdentifiers: z.string().optional(),
});

export const apiSaveAgentToolConfig = z.record(
	z.string(),
	z.object({
		enabled: z.boolean().optional(),
		confirm: z.boolean().optional(),
	}),
);

export const apiSaveAgentMcpConfig = z.object({
	enabled: z.boolean(),
	mode: z.enum(["full", "read-only", "custom"]),
	disabledRouters: z.array(z.string()).default([]),
});

export const apiAgentChat = z.object({
	message: z.string().min(1, { message: "Message is required" }),
	conversationId: z.string().optional(),
});
