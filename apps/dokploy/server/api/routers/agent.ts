import { apiAgentChat, apiSaveAgent } from "@dokploy/server/db/schema/agent";
import {
	deleteConversation,
	findAgentByOrganizationId,
	findConversationById,
	findConversationsByAgentId,
	findMessagesByConversationId,
	saveAgent,
} from "@dokploy/server/services/agent";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { runAgent } from "@/server/agent/run-agent";
import {
	getTelegramBotInfo,
	reloadAgentGateway,
} from "@/server/agent/telegram-gateway";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";

const requireAgent = async (organizationId: string) => {
	const agent = await findAgentByOrganizationId(organizationId);
	if (!agent) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "The agent is not configured yet",
		});
	}
	return agent;
};

const requireConversation = async (
	organizationId: string,
	conversationId: string,
) => {
	const agent = await requireAgent(organizationId);
	const conversation = await findConversationById(conversationId);
	if (conversation.agentId !== agent.agentId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You don't have access to this conversation",
		});
	}
	return conversation;
};

export const agentRouter = createTRPCRouter({
	get: adminProcedure.query(async ({ ctx }) => {
		const agent = await findAgentByOrganizationId(
			ctx.session.activeOrganizationId,
		);
		return agent ?? null;
	}),

	save: adminProcedure.input(apiSaveAgent).mutation(async ({ ctx, input }) => {
		const agent = await saveAgent(
			ctx.session.activeOrganizationId,
			ctx.user.id,
			input,
		);
		await reloadAgentGateway(ctx.session.activeOrganizationId);
		return agent;
	}),

	testTelegramBot: adminProcedure
		.input(z.object({ token: z.string().min(1) }))
		.mutation(async ({ input }) => {
			try {
				const bot = await getTelegramBotInfo(input.token);
				return {
					username: bot.username,
					name: bot.first_name,
				};
			} catch (error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						error instanceof Error
							? error.message
							: "Failed to connect to Telegram",
				});
			}
		}),

	chat: adminProcedure.input(apiAgentChat).mutation(async ({ ctx, input }) => {
		const agent = await requireAgent(ctx.session.activeOrganizationId);
		try {
			return await runAgent({
				agentId: agent.agentId,
				message: input.message,
				source: "web",
				conversationId: input.conversationId,
			});
		} catch (error) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: error instanceof Error ? error.message : `Error: ${error}`,
			});
		}
	}),

	conversations: adminProcedure.query(async ({ ctx }) => {
		const agent = await findAgentByOrganizationId(
			ctx.session.activeOrganizationId,
		);
		if (!agent) return [];
		return await findConversationsByAgentId(agent.agentId);
	}),

	messages: adminProcedure
		.input(z.object({ conversationId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await requireConversation(
				ctx.session.activeOrganizationId,
				input.conversationId,
			);
			return await findMessagesByConversationId(input.conversationId);
		}),

	deleteConversation: adminProcedure
		.input(z.object({ conversationId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireConversation(
				ctx.session.activeOrganizationId,
				input.conversationId,
			);
			return await deleteConversation(input.conversationId);
		}),
});
