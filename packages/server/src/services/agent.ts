import { db } from "@dokploy/server/db";
import {
	agent,
	agentChannel,
	agentConversation,
	agentMemory,
	agentMessage,
	agentPendingAction,
	agentSkill,
} from "@dokploy/server/db/schema";
import type {
	AgentMcpConfig,
	AgentToolConfig,
	apiSaveAgent,
	apiSaveAgentChannel,
	apiSaveAgentMemory,
	apiSaveAgentSkill,
} from "@dokploy/server/db/schema/agent";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

export const findAgentByOrganizationId = async (organizationId: string) => {
	return await db.query.agent.findFirst({
		where: eq(agent.organizationId, organizationId),
		with: {
			ai: true,
		},
	});
};

export const findAgentById = async (agentId: string) => {
	const result = await db.query.agent.findFirst({
		where: eq(agent.agentId, agentId),
		with: {
			ai: true,
		},
	});
	if (!result) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Agent not found",
		});
	}
	return result;
};

export const findChannelsByAgentId = async (agentId: string) => {
	return await db.query.agentChannel.findMany({
		where: eq(agentChannel.agentId, agentId),
		orderBy: asc(agentChannel.createdAt),
	});
};

export const findChannelById = async (channelId: string) => {
	const channel = await db.query.agentChannel.findFirst({
		where: eq(agentChannel.channelId, channelId),
	});
	if (!channel) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Channel not found",
		});
	}
	return channel;
};

export const findChannelsByType = async (
	type: "telegram" | "discord" | "slack" | "whatsapp" | "signal" | "email",
) => {
	return await db.query.agentChannel.findMany({
		where: eq(agentChannel.type, type),
	});
};

/** Every channel that should be running, across all organizations. */
export const findAllRunnableChannels = async () => {
	const channels = await db.query.agentChannel.findMany({
		where: eq(agentChannel.isEnabled, true),
		with: {
			agent: true,
		},
	});
	return channels.filter((channel) => channel.agent.isEnabled);
};

export const saveAgentChannel = async (
	agentId: string,
	input: z.infer<typeof apiSaveAgentChannel>,
) => {
	if (input.channelId) {
		const existing = await findChannelById(input.channelId);
		if (existing.agentId !== agentId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Channel does not belong to this agent",
			});
		}
		const updated = await db
			.update(agentChannel)
			.set({
				type: input.type,
				isEnabled: input.isEnabled,
				// Merge so blanked-out secret fields keep their stored value.
				credentials: { ...existing.credentials, ...input.credentials },
				allowedIdentifiers: input.allowedIdentifiers,
			})
			.where(eq(agentChannel.channelId, input.channelId))
			.returning();
		return updated[0];
	}
	const created = await db
		.insert(agentChannel)
		.values({
			agentId,
			type: input.type,
			isEnabled: input.isEnabled,
			credentials: input.credentials,
			allowedIdentifiers: input.allowedIdentifiers,
		})
		.returning();
	return created[0];
};

export const deleteAgentChannel = async (channelId: string) => {
	await db.delete(agentChannel).where(eq(agentChannel.channelId, channelId));
	return true;
};

export const saveAgent = async (
	organizationId: string,
	userId: string,
	input: z.infer<typeof apiSaveAgent>,
) => {
	const existing = await findAgentByOrganizationId(organizationId);
	if (existing) {
		const updated = await db
			.update(agent)
			.set({
				...input,
				userId,
			})
			.where(eq(agent.agentId, existing.agentId))
			.returning();
		return updated[0];
	}
	const created = await db
		.insert(agent)
		.values({
			...input,
			name: input.name || "Dokploy Agent",
			organizationId,
			userId,
		})
		.returning();
	return created[0];
};

export const updateAgentSettings = async (
	agentId: string,
	data: {
		aiId?: string | null;
		model?: string | null;
		toolConfig?: AgentToolConfig;
		mcpConfig?: AgentMcpConfig;
	},
) => {
	const updated = await db
		.update(agent)
		.set(data)
		.where(eq(agent.agentId, agentId))
		.returning();
	return updated[0];
};

export const findConversationsByAgentId = async (agentId: string) => {
	return await db.query.agentConversation.findMany({
		where: eq(agentConversation.agentId, agentId),
		orderBy: desc(agentConversation.updatedAt),
	});
};

export const findConversationById = async (conversationId: string) => {
	const conversation = await db.query.agentConversation.findFirst({
		where: eq(agentConversation.conversationId, conversationId),
	});
	if (!conversation) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Conversation not found",
		});
	}
	return conversation;
};

export type AgentSource =
	| "telegram"
	| "discord"
	| "slack"
	| "whatsapp"
	| "signal"
	| "email"
	| "terminal"
	| "web";

export const findOrCreateConversation = async (input: {
	agentId: string;
	source: AgentSource;
	externalChatId?: string;
	conversationId?: string;
	title?: string;
}) => {
	if (input.conversationId) {
		const conversation = await findConversationById(input.conversationId);
		if (conversation.agentId !== input.agentId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Conversation does not belong to this agent",
			});
		}
		return conversation;
	}
	if (input.source !== "web" && input.externalChatId) {
		const existing = await db.query.agentConversation.findFirst({
			where: and(
				eq(agentConversation.agentId, input.agentId),
				eq(agentConversation.source, input.source),
				eq(agentConversation.externalChatId, input.externalChatId),
			),
		});
		if (existing) {
			return existing;
		}
	}
	const created = await db
		.insert(agentConversation)
		.values({
			agentId: input.agentId,
			source: input.source,
			externalChatId: input.externalChatId,
			gatewaySessionKey: input.externalChatId,
			title: input.title,
		})
		.returning();
	if (!created[0]) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create conversation",
		});
	}
	return created[0];
};

/**
 * Detaches the chat's active conversation so the next message starts a fresh
 * one. The old conversation (and its history) stays visible in the dashboard.
 */
export const detachConversation = async (
	agentId: string,
	source: AgentSource,
	externalChatId: string,
) => {
	if (source === "web") return false;
	const detached = await db
		.update(agentConversation)
		.set({ externalChatId: null })
		.where(
			and(
				eq(agentConversation.agentId, agentId),
				eq(agentConversation.source, source),
				eq(agentConversation.externalChatId, externalChatId),
			),
		)
		.returning();
	return detached.length > 0;
};

export const findMessagesByConversationId = async (
	conversationId: string,
	limit?: number,
) => {
	const messages = await db.query.agentMessage.findMany({
		where: eq(agentMessage.conversationId, conversationId),
		orderBy: asc(agentMessage.createdAt),
	});
	if (limit && messages.length > limit) {
		return messages.slice(messages.length - limit);
	}
	return messages;
};

export const findConversationByExternalChat = async (
	agentId: string,
	source: AgentSource,
	externalChatId: string,
) => {
	return await db.query.agentConversation.findFirst({
		where: and(
			eq(agentConversation.agentId, agentId),
			eq(agentConversation.source, source),
			eq(agentConversation.externalChatId, externalChatId),
		),
	});
};

export const findConversationsForSource = async (
	agentId: string,
	source: AgentSource,
	gatewaySessionKey: string,
) => {
	return await db.query.agentConversation.findMany({
		where: and(
			eq(agentConversation.agentId, agentId),
			eq(agentConversation.source, source),
			eq(agentConversation.gatewaySessionKey, gatewaySessionKey),
		),
		orderBy: desc(agentConversation.updatedAt),
	});
};

export const attachConversationToExternalChat = async (input: {
	agentId: string;
	source: AgentSource;
	externalChatId: string;
	conversationId: string;
}) => {
	const conversation = await findConversationById(input.conversationId);
	if (
		conversation.agentId !== input.agentId ||
		conversation.source !== input.source ||
		conversation.gatewaySessionKey !== input.externalChatId
	) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Conversation does not belong to this gateway chat",
		});
	}
	await detachConversation(input.agentId, input.source, input.externalChatId);
	const updated = await db
		.update(agentConversation)
		.set({
			externalChatId: input.externalChatId,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(agentConversation.conversationId, input.conversationId))
		.returning();
	return updated[0];
};

export const renameConversation = async (
	conversationId: string,
	title: string,
) => {
	const updated = await db
		.update(agentConversation)
		.set({ title: title.slice(0, 120), updatedAt: new Date().toISOString() })
		.where(eq(agentConversation.conversationId, conversationId))
		.returning();
	return updated[0];
};

/** Remove the latest stored user/assistant exchange and return its user text. */
export const undoLastConversationExchange = async (conversationId: string) => {
	const messages = await db.query.agentMessage.findMany({
		where: eq(agentMessage.conversationId, conversationId),
		orderBy: desc(agentMessage.createdAt),
		limit: 4,
	});
	const userIndex = messages.findIndex((message) => message.role === "user");
	if (userIndex === -1) return null;
	const removed = messages.slice(0, userIndex + 1);
	await db.delete(agentMessage).where(
		inArray(
			agentMessage.messageId,
			removed.map((item) => item.messageId),
		),
	);
	await db
		.update(agentConversation)
		.set({ updatedAt: new Date().toISOString() })
		.where(eq(agentConversation.conversationId, conversationId));
	return messages[userIndex]?.content ?? null;
};

export const createAgentMessage = async (input: {
	conversationId: string;
	role: "user" | "assistant";
	content: string;
	toolCalls?: string | null;
}) => {
	const created = await db.insert(agentMessage).values(input).returning();
	await db
		.update(agentConversation)
		.set({ updatedAt: new Date().toISOString() })
		.where(eq(agentConversation.conversationId, input.conversationId));
	return created[0];
};

export const deleteConversation = async (conversationId: string) => {
	await db
		.delete(agentConversation)
		.where(eq(agentConversation.conversationId, conversationId));
	return true;
};

const PENDING_ACTION_TTL_MS = 15 * 60 * 1000;

export const createPendingAction = async (input: {
	agentId: string;
	conversationId: string;
	channelId?: string | null;
	externalChatId?: string | null;
	toolName: string;
	toolInput: unknown;
	summary: string;
}) => {
	const created = await db
		.insert(agentPendingAction)
		.values({
			agentId: input.agentId,
			conversationId: input.conversationId,
			channelId: input.channelId ?? null,
			externalChatId: input.externalChatId ?? null,
			toolName: input.toolName,
			toolInput: input.toolInput ?? {},
			summary: input.summary,
		})
		.returning();
	if (!created[0]) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Failed to create the pending action",
		});
	}
	return created[0];
};

export const findPendingActionById = async (actionId: string) => {
	const action = await db.query.agentPendingAction.findFirst({
		where: eq(agentPendingAction.actionId, actionId),
	});
	if (!action) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Pending action not found",
		});
	}
	return action;
};

export const findLatestPendingActionForChat = async (
	agentId: string,
	channelId: string,
	externalChatId: string,
) => {
	return await db.query.agentPendingAction.findFirst({
		where: and(
			eq(agentPendingAction.agentId, agentId),
			eq(agentPendingAction.channelId, channelId),
			eq(agentPendingAction.externalChatId, externalChatId),
			eq(agentPendingAction.status, "pending"),
		),
		orderBy: desc(agentPendingAction.createdAt),
	});
};

export const isPendingActionExpired = (action: {
	createdAt: string;
	status: string;
}) => {
	if (action.status !== "pending") return false;
	return (
		Date.now() - new Date(action.createdAt).getTime() > PENDING_ACTION_TTL_MS
	);
};

export const updatePendingActionStatus = async (
	actionId: string,
	status: "pending" | "approved" | "rejected" | "expired",
) => {
	const updated = await db
		.update(agentPendingAction)
		.set({ status })
		.where(eq(agentPendingAction.actionId, actionId))
		.returning();
	return updated[0];
};

export const findAgentSkills = async (agentId: string) => {
	return await db.query.agentSkill.findMany({
		where: eq(agentSkill.agentId, agentId),
		orderBy: asc(agentSkill.name),
	});
};

export const findAgentSkillByName = async (agentId: string, name: string) => {
	return await db.query.agentSkill.findFirst({
		where: and(eq(agentSkill.agentId, agentId), eq(agentSkill.name, name)),
	});
};

export const saveAgentSkill = async (
	agentId: string,
	input: z.infer<typeof apiSaveAgentSkill>,
	origin: "agent" | "admin" = "agent",
) => {
	const now = new Date().toISOString();
	const saved = await db
		.insert(agentSkill)
		.values({ ...input, agentId, origin, updatedAt: now })
		.onConflictDoUpdate({
			target: [agentSkill.agentId, agentSkill.name],
			set: {
				description: input.description,
				content: input.content,
				origin,
				version: sql`${agentSkill.version} + 1`,
				updatedAt: now,
			},
		})
		.returning();
	return saved[0];
};

export const recordAgentSkillUse = async (skillId: string) => {
	await db
		.update(agentSkill)
		.set({ usageCount: sql`${agentSkill.usageCount} + 1` })
		.where(eq(agentSkill.skillId, skillId));
};

export const deleteAgentSkill = async (agentId: string, skillId: string) => {
	const removed = await db
		.delete(agentSkill)
		.where(
			and(eq(agentSkill.agentId, agentId), eq(agentSkill.skillId, skillId)),
		)
		.returning();
	return removed.length > 0;
};

export const findAgentMemories = async (agentId: string) => {
	return await db.query.agentMemory.findMany({
		where: eq(agentMemory.agentId, agentId),
		orderBy: asc(agentMemory.key),
	});
};

export const saveAgentMemory = async (
	agentId: string,
	input: z.infer<typeof apiSaveAgentMemory>,
	origin: "agent" | "admin" = "agent",
) => {
	const now = new Date().toISOString();
	const saved = await db
		.insert(agentMemory)
		.values({ ...input, agentId, origin, updatedAt: now })
		.onConflictDoUpdate({
			target: [agentMemory.agentId, agentMemory.key],
			set: { content: input.content, origin, updatedAt: now },
		})
		.returning();
	return saved[0];
};

export const deleteAgentMemory = async (agentId: string, key: string) => {
	const removed = await db
		.delete(agentMemory)
		.where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)))
		.returning();
	return removed.length > 0;
};
