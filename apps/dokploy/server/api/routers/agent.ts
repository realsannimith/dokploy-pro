import {
	type AgentChannelCredentials,
	apiAgentChat,
	apiSaveAgent,
	apiSaveAgentChannel,
	apiSaveAgentMcpConfig,
	apiSaveAgentSkill,
	apiSaveAgentToolConfig,
} from "@dokploy/server/db/schema/agent";
import {
	deleteAgentChannel,
	deleteAgentSkill,
	deleteConversation,
	findAgentByOrganizationId,
	findAgentSkills,
	findChannelById,
	findChannelsByAgentId,
	findConversationById,
	findConversationsByAgentId,
	findMessagesByConversationId,
	saveAgent,
	saveAgentChannel,
	saveAgentSkill,
	updateAgentSettings,
} from "@dokploy/server/services/agent";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
	getGatewayRuntime,
	reloadAgentGateways,
} from "@/server/agent/gateways";
import { getDiscordBotInfo } from "@/server/agent/gateways/discord";
import { verifyEmailChannel } from "@/server/agent/gateways/email";
import { getSignalInfo } from "@/server/agent/gateways/signal";
import { getSlackBotInfo } from "@/server/agent/gateways/slack";
import { getTelegramBotInfo } from "@/server/agent/gateways/telegram";
import { getWhatsappInfo } from "@/server/agent/gateways/whatsapp";
import { runAgent } from "@/server/agent/run-agent";
import { AGENT_TOOL_META, resolveToolSetting } from "@/server/agent/tools";
import { adminProcedure, createTRPCRouter } from "@/server/api/trpc";
import { resolveMcpPolicy, routerOfTool } from "@/server/mcp/policy";
import { getMcpTools } from "@/server/mcp/registry";

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

const requireChannel = async (organizationId: string, channelId: string) => {
	const agent = await requireAgent(organizationId);
	const channel = await findChannelById(channelId);
	if (channel.agentId !== agent.agentId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You don't have access to this channel",
		});
	}
	return { agent, channel };
};

const SECRET_CREDENTIAL_KEYS = [
	"botToken",
	"appToken",
	"accessToken",
	"verifyToken",
	"imapPassword",
	"smtpPassword",
] as const;

/** Secrets never leave the server; the UI only needs to know one is stored. */
const redactCredentials = (credentials: AgentChannelCredentials) => {
	const redacted = { ...credentials };
	for (const key of SECRET_CREDENTIAL_KEYS) {
		if (redacted[key]) {
			redacted[key] = "__stored__";
		}
	}
	return redacted;
};

const toTRPCError = (error: unknown) =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: error instanceof Error ? error.message : `Error: ${error}`,
	});

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
		await reloadAgentGateways(ctx.session.activeOrganizationId);
		return agent;
	}),

	tools: adminProcedure.query(async ({ ctx }) => {
		const agent = await findAgentByOrganizationId(
			ctx.session.activeOrganizationId,
		);
		return AGENT_TOOL_META.map((meta) => ({
			name: meta.name,
			group: meta.group,
			description: meta.description,
			destructive: !!meta.destructive,
			...resolveToolSetting(meta.name, agent?.toolConfig),
		}));
	}),

	saveToolConfig: adminProcedure
		.input(apiSaveAgentToolConfig)
		.mutation(async ({ ctx, input }) => {
			const agent = await requireAgent(ctx.session.activeOrganizationId);
			const knownNames = new Set(AGENT_TOOL_META.map((meta) => meta.name));
			const toolConfig: typeof input = {};
			for (const [name, setting] of Object.entries(input)) {
				if (knownNames.has(name)) {
					toolConfig[name] = setting;
				}
			}
			await updateAgentSettings(agent.agentId, { toolConfig });
			return true;
		}),

	mcpInfo: adminProcedure.query(async ({ ctx }) => {
		const agent = await findAgentByOrganizationId(
			ctx.session.activeOrganizationId,
		);
		const routers = new Map<
			string,
			{ router: string; total: number; queries: number; mutations: number }
		>();
		for (const tool of getMcpTools().values()) {
			const router = routerOfTool(tool);
			const entry = routers.get(router) ?? {
				router,
				total: 0,
				queries: 0,
				mutations: 0,
			};
			entry.total += 1;
			if (tool.type === "query") entry.queries += 1;
			else entry.mutations += 1;
			routers.set(router, entry);
		}
		return {
			policy: resolveMcpPolicy(agent?.mcpConfig),
			routers: [...routers.values()].sort((a, b) =>
				a.router.localeCompare(b.router),
			),
		};
	}),

	saveMcpConfig: adminProcedure
		.input(apiSaveAgentMcpConfig)
		.mutation(async ({ ctx, input }) => {
			const agent = await requireAgent(ctx.session.activeOrganizationId);
			await updateAgentSettings(agent.agentId, { mcpConfig: input });
			return true;
		}),

	skills: adminProcedure.query(async ({ ctx }) => {
		const agent = await findAgentByOrganizationId(
			ctx.session.activeOrganizationId,
		);
		if (!agent) return [];
		return await findAgentSkills(agent.agentId);
	}),

	saveSkill: adminProcedure
		.input(apiSaveAgentSkill)
		.mutation(async ({ ctx, input }) => {
			const agent = await requireAgent(ctx.session.activeOrganizationId);
			return await saveAgentSkill(agent.agentId, input, "admin");
		}),

	deleteSkill: adminProcedure
		.input(z.object({ skillId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const agent = await requireAgent(ctx.session.activeOrganizationId);
			return await deleteAgentSkill(agent.agentId, input.skillId);
		}),

	channels: adminProcedure.query(async ({ ctx }) => {
		const agent = await findAgentByOrganizationId(
			ctx.session.activeOrganizationId,
		);
		if (!agent) return [];
		const channels = await findChannelsByAgentId(agent.agentId);
		return channels.map((channel) => ({
			...channel,
			credentials: redactCredentials(channel.credentials),
			runtime: getGatewayRuntime(channel.channelId),
		}));
	}),

	saveChannel: adminProcedure
		.input(apiSaveAgentChannel)
		.mutation(async ({ ctx, input }) => {
			const agent = await requireAgent(ctx.session.activeOrganizationId);
			if (input.channelId) {
				await requireChannel(ctx.session.activeOrganizationId, input.channelId);
			}
			const channel = await saveAgentChannel(agent.agentId, input);
			await reloadAgentGateways(ctx.session.activeOrganizationId);
			return channel;
		}),

	deleteChannel: adminProcedure
		.input(z.object({ channelId: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			await requireChannel(ctx.session.activeOrganizationId, input.channelId);
			const result = await deleteAgentChannel(input.channelId);
			await reloadAgentGateways(ctx.session.activeOrganizationId);
			return result;
		}),

	testChannel: adminProcedure
		.input(apiSaveAgentChannel)
		.mutation(async ({ ctx, input }) => {
			// Fall back to stored secrets so a user can test without retyping them.
			let credentials = input.credentials;
			if (input.channelId) {
				const { channel } = await requireChannel(
					ctx.session.activeOrganizationId,
					input.channelId,
				);
				credentials = { ...channel.credentials, ...input.credentials };
			}

			try {
				switch (input.type) {
					case "telegram": {
						const bot = await getTelegramBotInfo(credentials.botToken || "");
						return {
							label: `@${bot.username}`,
							url: `https://t.me/${bot.username}`,
						};
					}
					case "discord": {
						const bot = await getDiscordBotInfo(credentials.botToken || "");
						return { label: `${bot.username} (${bot.id})` };
					}
					case "slack": {
						const info = await getSlackBotInfo(
							credentials.botToken || "",
							credentials.appToken || "",
						);
						return { label: `${info.user} on ${info.team}` };
					}
					case "whatsapp": {
						const info = await getWhatsappInfo(
							credentials.accessToken || "",
							credentials.phoneNumberId || "",
						);
						return { label: `${info.name} ${info.number}`.trim() };
					}
					case "signal": {
						await getSignalInfo(
							credentials.apiUrl || "",
							credentials.number || "",
						);
						return { label: `${credentials.number} registered` };
					}
					case "email": {
						await verifyEmailChannel(credentials);
						return { label: "IMAP and SMTP reachable" };
					}
				}
			} catch (error) {
				throw toTRPCError(error);
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
			throw toTRPCError(error);
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
