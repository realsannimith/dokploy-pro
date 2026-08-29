import {
	findAgentByOrganizationId,
	findAllEnabledTelegramAgents,
} from "@dokploy/server/services/agent";
import { isAllowed, parseAllowlist } from "./access";

interface TelegramUser {
	id: number;
	username?: string;
	first_name?: string;
}

interface TelegramMessage {
	message_id: number;
	from?: TelegramUser;
	chat: { id: number; type: string };
	text?: string;
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
}

interface PollerHandle {
	stopped: boolean;
	abort: AbortController | null;
}

// Survives Next.js dev-mode module reloads.
const globalStore = globalThis as unknown as {
	__dokployTelegramPollers?: Map<string, PollerHandle>;
};
if (!globalStore.__dokployTelegramPollers) {
	globalStore.__dokployTelegramPollers = new Map();
}
const pollers = globalStore.__dokployTelegramPollers;

const telegramApi = async (
	token: string,
	method: string,
	body?: Record<string, unknown>,
	signal?: AbortSignal,
) => {
	const response = await fetch(
		`https://api.telegram.org/bot${token}/${method}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
			signal,
		},
	);
	const payload = (await response.json()) as {
		ok: boolean;
		result?: unknown;
		description?: string;
		error_code?: number;
	};
	if (!payload.ok) {
		const error = new Error(
			`Telegram ${method} failed: ${payload.description || response.status}`,
		);
		(error as any).errorCode = payload.error_code;
		throw error;
	}
	return payload.result;
};

export const getTelegramBotInfo = async (token: string) => {
	return (await telegramApi(token, "getMe")) as {
		id: number;
		username: string;
		first_name: string;
	};
};

const sendTelegramMessage = async (
	token: string,
	chatId: number,
	text: string,
) => {
	const CHUNK = 4000;
	for (let i = 0; i < text.length; i += CHUNK) {
		await telegramApi(token, "sendMessage", {
			chat_id: chatId,
			text: text.slice(i, i + CHUNK),
			link_preview_options: { is_disabled: true },
		});
	}
};

const handleMessage = async (
	agentId: string,
	token: string,
	message: TelegramMessage,
) => {
	const chatId = message.chat.id;
	const text = message.text?.trim();
	if (!text) return;

	// Lazy imports: break the module cycle with the tRPC router, and reload
	// config on every message so allowlist/instruction edits apply without
	// restarting the poller.
	const { runAgent } = await import("./run-agent");
	const { findAgentById } = await import("@dokploy/server/services/agent");
	const agent = await findAgentById(agentId);
	const allowlist = parseAllowlist(agent.telegramAllowedUserIds);

	if (!isAllowed(allowlist, message.from)) {
		await sendTelegramMessage(
			token,
			chatId,
			`You are not authorized to use this agent.\n\nYour Telegram user ID is: ${message.from?.id}\n\nAn administrator can add it under Settings -> AI Agent -> Allowed Telegram users in Dokploy.`,
		);
		return;
	}

	if (text === "/start") {
		await sendTelegramMessage(
			token,
			chatId,
			`Hi ${message.from?.first_name || ""}! I'm ${agent.name}, your Dokploy assistant. Ask me things like:\n\n- "What projects do I have?"\n- "Deploy my api service"\n- "Are the database backups running?"\n- "Show the last deployment logs for my app"`,
		);
		return;
	}

	const typing = setInterval(() => {
		telegramApi(token, "sendChatAction", {
			chat_id: chatId,
			action: "typing",
		}).catch(() => {});
	}, 4500);
	telegramApi(token, "sendChatAction", {
		chat_id: chatId,
		action: "typing",
	}).catch(() => {});

	try {
		const result = await runAgent({
			agentId,
			message: text,
			source: "telegram",
			externalChatId: String(chatId),
		});
		await sendTelegramMessage(token, chatId, result.text);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await sendTelegramMessage(
			token,
			chatId,
			`Something went wrong: ${message}`,
		).catch(() => {});
	} finally {
		clearInterval(typing);
	}
};

const pollLoop = async (
	agentId: string,
	token: string,
	handle: PollerHandle,
) => {
	let offset = 0;
	// Drop updates that arrived while the gateway was offline so the bot
	// doesn't replay old commands on restart.
	try {
		const pending = (await telegramApi(token, "getUpdates", {
			timeout: 0,
			offset: -1,
		})) as TelegramUpdate[];
		if (pending.length > 0) {
			offset = pending[pending.length - 1]!.update_id + 1;
		}
	} catch {
		// getMe/getUpdates failures are handled in the main loop below
	}

	while (!handle.stopped) {
		try {
			handle.abort = new AbortController();
			const updates = (await telegramApi(
				token,
				"getUpdates",
				{
					timeout: 50,
					offset,
					allowed_updates: ["message"],
				},
				handle.abort.signal,
			)) as TelegramUpdate[];

			for (const update of updates) {
				offset = update.update_id + 1;
				if (handle.stopped) break;
				if (update.message) {
					await handleMessage(agentId, token, update.message);
				}
			}
		} catch (error) {
			if (handle.stopped) break;
			const errorCode = (error as any)?.errorCode;
			if (errorCode === 401 || errorCode === 404) {
				console.error(
					`[agent-gateway] Telegram token invalid for agent ${agentId}, stopping poller`,
				);
				break;
			}
			if (errorCode === 409) {
				// Another process is polling this bot (e.g. an old instance) —
				// wait and retry instead of hot-looping.
				await new Promise((resolve) => setTimeout(resolve, 30_000));
				continue;
			}
			await new Promise((resolve) => setTimeout(resolve, 5_000));
		}
	}
	pollers.delete(agentId);
};

export const stopTelegramPoller = (agentId: string) => {
	const handle = pollers.get(agentId);
	if (handle) {
		handle.stopped = true;
		handle.abort?.abort();
		pollers.delete(agentId);
	}
};

export const startTelegramPoller = (agentId: string, token: string) => {
	stopTelegramPoller(agentId);
	const handle: PollerHandle = { stopped: false, abort: null };
	pollers.set(agentId, handle);
	void pollLoop(agentId, token, handle);
	console.log(`[agent-gateway] Telegram poller started for agent ${agentId}`);
};

export const reloadAgentGateway = async (organizationId: string) => {
	const agent = await findAgentByOrganizationId(organizationId);
	if (!agent) return;
	if (agent.isEnabled && agent.telegramEnabled && agent.telegramBotToken) {
		startTelegramPoller(agent.agentId, agent.telegramBotToken);
	} else {
		stopTelegramPoller(agent.agentId);
	}
};

export const initAgentGateways = async () => {
	try {
		const agents = await findAllEnabledTelegramAgents();
		for (const agent of agents) {
			if (agent.telegramBotToken) {
				startTelegramPoller(agent.agentId, agent.telegramBotToken);
			}
		}
		if (agents.length > 0) {
			console.log(
				`[agent-gateway] Started ${agents.length} Telegram gateway(s)`,
			);
		}
	} catch (error) {
		console.error("[agent-gateway] Failed to initialize gateways", error);
	}
};
