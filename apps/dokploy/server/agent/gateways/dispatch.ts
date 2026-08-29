import type { AgentSource } from "@dokploy/server/services/agent";
import { matchesAllowlist, parseAllowlist } from "../access";
import { LEARN_SKILL_CONTEXT, resolveSkillInvocation } from "../skills";
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
	/** Optional observable tool-step delivery for richer gateways. */
	sendProgress?: (text: string) => Promise<void>;
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
- "Show the last deployment logs for my app"

Commands:
/new - start a fresh conversation (clears my context)
/skills - list reusable skills
/learn <workflow> - teach me a reusable skill
/help - show this help`;

const friendlyToolName = (name: string) =>
	name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

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

	// In group chats Telegram sends commands as "/new@botname".
	const command = text.split(/\s+/)[0]?.split("@")[0]?.toLowerCase();

	if (command === "/start" || command === "/help") {
		await input.reply(
			`Hi! I'm ${agent.name}, your Dokploy assistant.\n\n${HELP_TEXT}`,
		);
		return;
	}

	if (command === "/new" || command === "/reset") {
		const { detachConversation } = await import(
			"@dokploy/server/services/agent"
		);
		const detached = await detachConversation(
			input.agentId,
			input.source,
			input.externalChatId,
		);
		await input.reply(
			detached
				? "Started a fresh conversation - my previous context is cleared. (The old chat history stays available in the Dokploy dashboard.)"
				: "You're already in a fresh conversation. What can I do for you?",
		);
		return;
	}

	const { findAgentSkills, recordAgentSkillUse } = await import(
		"@dokploy/server/services/agent"
	);
	const skills = await findAgentSkills(input.agentId).catch(async (error) => {
		const message = error instanceof Error ? error.message : String(error);
		await input
			.reply(`I couldn't load agent skills: ${message}`)
			.catch(() => {});
		return null;
	});
	if (!skills) return;
	if (command === "/skills") {
		await input.reply(
			skills.length > 0
				? `Reusable skills:\n\n${skills
						.map(
							(skill) =>
								`/${skill.name} — ${skill.description} (v${skill.version}, used ${skill.usageCount}×)`,
						)
						.join(
							"\n",
						)}\n\nRun /skill-name followed by a request, or /learn <workflow> to teach me a new one.`
				: "I haven't learned any reusable skills yet. Use /learn <workflow> to teach me one, or ask me to remember a repeatable process after we finish it.",
		);
		return;
	}

	let context: string | undefined;
	if (command === "/learn") {
		const source = text.replace(/^\/learn(?:@[^\s]+)?\s*/i, "").trim();
		if (!source) {
			await input.reply(
				"Tell me what to learn after the command. Example: /learn how we deploy the staging API and verify it is healthy",
			);
			return;
		}
		context = LEARN_SKILL_CONTEXT;
	} else {
		const invocation = resolveSkillInvocation(text, skills);
		if (invocation) {
			context = invocation.context;
			await Promise.all(
				invocation.loaded.map((skill) => recordAgentSkillUse(skill.skillId)),
			);
		}
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
			context,
			confirmation,
			onProgress: input.sendProgress
				? async ({ step, toolName, success, durationMs }) => {
						await input.sendProgress?.(
							`${success ? "✅" : "⚠️"} Step ${step}: ${friendlyToolName(toolName)} ${
								success ? "complete" : "failed"
							} (${Math.max(0.1, durationMs / 1000).toFixed(1)}s)`,
						);
					}
				: undefined,
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
