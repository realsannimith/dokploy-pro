import type { AgentSource } from "@dokploy/server/services/agent";
import { matchesAllowlist, parseAllowlist } from "../access";
import type { AgentConfirmationHandler } from "../tools";

export interface DispatchInput {
	agentId: string;
	channelId: string;
	source: AgentSource;
	/** Conversation key — one conversation per chat/thread/sender. */
	externalChatId: string;
	text: string;
	/** Candidate identities for the allowlist (id, username, email, number). */
	identifiers: Array<string | number | undefined | null>;
	reply: (text: string) => Promise<void>;
	onUnauthorized?: (identifiers: string) => Promise<void>;
	/**
	 * Gateways that support interactive Approve/Reject buttons pass this;
	 * sensitive tool calls are then stored as pending actions and shown to the
	 * user instead of executing immediately.
	 */
	sendConfirmation?: (request: {
		actionId: string;
		summary: string;
	}) => Promise<void>;
}

const HELP_TEXT = `Ask me things like:

- "What projects do I have?"
- "Deploy my api service"
- "Are the database backups running?"
- "Show the last deployment logs for my app"`;

/**
 * Shared path for every chat gateway: re-read the channel config (so
 * allowlist edits apply without a restart), authorize, run the agent and
 * reply. Keeping this in one place means all channels enforce the same rules.
 */
export const dispatchMessage = async (input: DispatchInput) => {
	const text = input.text?.trim();
	if (!text) return;

	const { findAgentById, findChannelById } = await import(
		"@dokploy/server/services/agent"
	);
	const channel = await findChannelById(input.channelId);
	const agent = await findAgentById(input.agentId);

	const allowlist = parseAllowlist(channel.allowedIdentifiers);
	if (!matchesAllowlist(allowlist, input.identifiers)) {
		const shown = input.identifiers
			.filter((value) => value !== undefined && value !== null && value !== "")
			.map(String)
			.join(", ");
		if (input.onUnauthorized) {
			await input.onUnauthorized(shown);
		} else {
			await input.reply(
				`You are not authorized to use this agent.\n\nYour identifier is: ${shown}\n\nAn administrator can add it in Dokploy under Settings -> AI Agent -> ${channel.type} -> Allowed users.`,
			);
		}
		return;
	}

	if (text === "/start" || text === "/help") {
		await input.reply(
			`Hi! I'm ${agent.name}, your Dokploy assistant.\n\n${HELP_TEXT}`,
		);
		return;
	}

	const { runAgent } = await import("../run-agent");
	try {
		let confirmation: AgentConfirmationHandler | undefined;
		let conversationId: string | undefined;
		const sendConfirmation = input.sendConfirmation;
		if (sendConfirmation) {
			// The pending action needs the conversation id, so resolve it up
			// front instead of letting runAgent create it.
			const { findOrCreateConversation, createPendingAction } = await import(
				"@dokploy/server/services/agent"
			);
			const conversation = await findOrCreateConversation({
				agentId: input.agentId,
				source: input.source,
				externalChatId: input.externalChatId,
				title: text.slice(0, 80),
			});
			conversationId = conversation.conversationId;
			confirmation = {
				request: async ({ toolName, summary, toolInput }) => {
					const action = await createPendingAction({
						agentId: input.agentId,
						conversationId: conversation.conversationId,
						channelId: input.channelId,
						externalChatId: input.externalChatId,
						toolName,
						toolInput,
						summary,
					});
					await sendConfirmation({ actionId: action.actionId, summary });
					return `CONFIRMATION SENT: "${summary}". Approve/Reject buttons were shown to the user; the action runs only if they tap Approve. Do not call this tool again — briefly tell the user a confirmation is waiting for them.`;
				},
			};
		}

		const result = await runAgent({
			agentId: input.agentId,
			message: text,
			source: input.source,
			externalChatId: input.externalChatId,
			conversationId,
			confirmation,
		});
		await input.reply(result.text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await input.reply(`Something went wrong: ${message}`).catch(() => {});
	}
};

export const chunkText = (text: string, size: number) => {
	const chunks: string[] = [];
	for (let i = 0; i < text.length; i += size) {
		chunks.push(text.slice(i, i + size));
	}
	return chunks.length > 0 ? chunks : [""];
};
