import { db } from "@dokploy/server/db";
import {
	agent,
	agentConversation,
	agentMessage,
} from "@dokploy/server/db/schema";
import type { apiSaveAgent } from "@dokploy/server/db/schema/agent";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
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

export const findAllEnabledTelegramAgents = async () => {
	return await db.query.agent.findMany({
		where: and(eq(agent.isEnabled, true), eq(agent.telegramEnabled, true)),
		with: {
			ai: true,
		},
	});
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

export const findOrCreateConversation = async (input: {
	agentId: string;
	source: "telegram" | "web";
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
	if (input.source === "telegram" && input.externalChatId) {
		const existing = await db.query.agentConversation.findFirst({
			where: and(
				eq(agentConversation.agentId, input.agentId),
				eq(agentConversation.source, "telegram"),
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
