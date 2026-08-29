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
/status - show the active session
/whoami - show this gateway identity and access scope
/sessions - list sessions for this gateway
/resume <id or title> - continue an older session
/title <name> - rename the active session
/undo - remove the last exchange
/retry - retry the last request
/skills - list reusable skills
/learn <workflow> - teach me a reusable skill
/approve [id] or /deny [id] - decide a pending action
/help - show this help`;

const friendlyToolName = (name: string) =>
	name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

export const parseGatewayCommand = (text: string) => {
	// Slack/Discord mentions can precede commands in shared channels.
	const normalized = text.trim().replace(/^<@!?[a-zA-Z0-9]+>\s*/, "");
	const [token = "", ...rest] = normalized.split(/\s+/);
	return {
		text: normalized,
		command: token.startsWith("/")
			? token.split("@")[0]?.toLowerCase()
			: undefined,
		args: rest.join(" ").trim(),
	};
};

/**
 * Shared path for every chat gateway: re-read the channel config (so
 * allowlist edits apply without a restart), authorize, run the agent and
 * reply. Keeping this in one place means all channels enforce the same rules.
 */
export const dispatchMessage = async (input: DispatchInput) => {
	const parsed = parseGatewayCommand(input.text ?? "");
	let text = parsed.text;
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

	const { command, args } = parsed;

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

	const services = await import("@dokploy/server/services/agent");
	const activeConversation = await services.findConversationByExternalChat(
		input.agentId,
		input.source,
		input.externalChatId,
	);

	if (command === "/whoami") {
		await input.reply(
			`Authorized on ${input.source}. Identity: ${input.identifiers
				.filter((value) => value != null && value !== "")
				.join(
					", ",
				)}. Commands and tools are limited by this gateway's allowlist and the agent permission policy.`,
		);
		return;
	}

	if (command === "/status") {
		if (!activeConversation) {
			await input.reply(
				`No active ${input.source} session yet. Send a message to start one.`,
			);
			return;
		}
		const messages = await services.findMessagesByConversationId(
			activeConversation.conversationId,
		);
		await input.reply(
			`Agent: ${agent.name}\nGateway: ${input.source}\nSession: ${activeConversation.title || "Untitled"}\nID: ${activeConversation.conversationId}\nMessages: ${messages.length}\nUpdated: ${activeConversation.updatedAt}`,
		);
		return;
	}

	if (command === "/sessions") {
		const sessions = await services.findConversationsForSource(
			input.agentId,
			input.source,
			input.externalChatId,
		);
		const query = args.toLowerCase();
		const shown = sessions
			.filter(
				(session) =>
					!query ||
					session.title?.toLowerCase().includes(query) ||
					session.conversationId.toLowerCase().includes(query),
			)
			.slice(0, 10);
		await input.reply(
			shown.length > 0
				? `Recent ${input.source} sessions:\n\n${shown
						.map(
							(session) =>
								`${session.conversationId.slice(0, 10)} — ${session.title || "Untitled"}${
									session.externalChatId === input.externalChatId
										? " (active)"
										: ""
								}`,
						)
						.join("\n")}\n\nUse /resume <id or title>.`
				: "No matching sessions found.",
		);
		return;
	}

	if (command === "/resume") {
		if (!args) {
			await input.reply("Use /resume <session id or title>.");
			return;
		}
		const sessions = await services.findConversationsForSource(
			input.agentId,
			input.source,
			input.externalChatId,
		);
		const wanted = args.toLowerCase();
		const selected =
			sessions.find((session) =>
				session.conversationId.toLowerCase().startsWith(wanted),
			) ?? sessions.find((session) => session.title?.toLowerCase() === wanted);
		if (!selected) {
			await input.reply(`No ${input.source} session matched "${args}".`);
			return;
		}
		await services.attachConversationToExternalChat({
			agentId: input.agentId,
			source: input.source,
			externalChatId: input.externalChatId,
			conversationId: selected.conversationId,
		});
		await input.reply(`Resumed: ${selected.title || selected.conversationId}`);
		return;
	}

	if (command === "/title") {
		if (!activeConversation) {
			await input.reply("There is no active session to rename.");
			return;
		}
		if (!args) {
			await input.reply(
				`Current title: ${activeConversation.title || "Untitled"}`,
			);
			return;
		}
		await services.renameConversation(activeConversation.conversationId, args);
		await input.reply(`Session renamed to: ${args.slice(0, 120)}`);
		return;
	}

	if (command === "/undo" || command === "/retry") {
		if (!activeConversation) {
			await input.reply("There is no active session history yet.");
			return;
		}
		const previous = await services.undoLastConversationExchange(
			activeConversation.conversationId,
		);
		if (!previous) {
			await input.reply("There is no exchange to undo.");
			return;
		}
		if (command === "/undo") {
			await input.reply("Removed the last user/assistant exchange.");
			return;
		}
		text = previous;
	}

	if (command === "/approve" || command === "/deny") {
		const action = args
			? await services.findPendingActionById(args).catch(() => undefined)
			: await services.findLatestPendingActionForChat(
					input.agentId,
					input.channelId,
					input.externalChatId,
				);
		if (
			!action ||
			action.agentId !== input.agentId ||
			action.channelId !== input.channelId ||
			action.externalChatId !== input.externalChatId
		) {
			await input.reply("No matching pending action exists in this chat.");
			return;
		}
		const { resolvePendingAction } = await import("../pending");
		const resolved = await resolvePendingAction(
			action.actionId,
			command === "/approve",
			String(input.identifiers.find((value) => value != null) ?? "user"),
		);
		await input.reply(
			`${resolved.status === "approved" ? "✅" : "❌"} ${resolved.summary}\n\n${resolved.text}`,
		);
		return;
	}

	const skills = await services
		.findAgentSkills(input.agentId)
		.catch(async (error) => {
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
				invocation.loaded.map((skill) =>
					services.recordAgentSkillUse(skill.skillId),
				),
			);
		}
	}

	const { runAgent } = await import("../run-agent");
	try {
		let confirmation: AgentConfirmationHandler | undefined;
		let conversationId: string | undefined;
		{
			// The pending action needs the conversation id, so resolve it up
			// front instead of letting runAgent create it.
			const conversation = await services.findOrCreateConversation({
				agentId: input.agentId,
				source: input.source,
				externalChatId: input.externalChatId,
				title: text.slice(0, 80),
			});
			conversationId = conversation.conversationId;
			confirmation = {
				request: async ({ toolName, summary, toolInput }) => {
					const action = await services.createPendingAction({
						agentId: input.agentId,
						conversationId: conversation.conversationId,
						channelId: input.channelId,
						externalChatId: input.externalChatId,
						toolName,
						toolInput,
						summary,
					});
					if (input.sendConfirmation) {
						await input.sendConfirmation({
							actionId: action.actionId,
							summary,
						});
					} else {
						await input.reply(
							`⚠️ Confirmation required\n\n${summary}\n\nReply /approve ${action.actionId} or /deny ${action.actionId}.`,
						);
					}
					return `CONFIRMATION SENT: "${summary}". The action runs only after the user approves it. Do not call this tool again; briefly say that confirmation is waiting.`;
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
