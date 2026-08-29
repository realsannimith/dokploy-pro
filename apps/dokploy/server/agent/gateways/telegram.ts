import { matchesAllowlist, parseAllowlist } from "../access";
import { dispatchMessage } from "./dispatch";
import {
	splitTelegramMarkdown,
	stripTelegramMarkdown,
	toTelegramMarkdown,
} from "./telegram-format";
import type { GatewayHandle, GatewayStartInput } from "./types";
import { sleep } from "./types";

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

interface TelegramCallbackQuery {
	id: string;
	from?: TelegramUser;
	message?: TelegramMessage;
	data?: string;
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
}

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
		(error as { errorCode?: number }).errorCode = payload.error_code;
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

const sendMessage = async (token: string, chatId: number, text: string) => {
	for (const chunk of splitTelegramMarkdown(toTelegramMarkdown(text))) {
		try {
			await telegramApi(token, "sendMessage", {
				chat_id: chatId,
				text: chunk,
				parse_mode: "MarkdownV2",
				link_preview_options: { is_disabled: true },
			});
		} catch (error) {
			// Telegram rejects the whole message when one entity is malformed;
			// deliver it unformatted instead of losing the answer.
			if ((error as { errorCode?: number }).errorCode !== 400) throw error;
			await telegramApi(token, "sendMessage", {
				chat_id: chatId,
				text: stripTelegramMarkdown(chunk),
				link_preview_options: { is_disabled: true },
			});
		}
	}
};

const CALLBACK_PREFIX = "aga:";

const sendConfirmationButtons = async (
	token: string,
	chatId: number,
	actionId: string,
	summary: string,
) => {
	await telegramApi(token, "sendMessage", {
		chat_id: chatId,
		text: `⚠️ Confirmation required\n\n${summary}\n\nDo you approve this action?`,
		reply_markup: {
			inline_keyboard: [
				[
					{
						text: "✅ Approve",
						callback_data: `${CALLBACK_PREFIX}${actionId}:y`,
					},
					{
						text: "❌ Reject",
						callback_data: `${CALLBACK_PREFIX}${actionId}:n`,
					},
				],
			],
		},
	});
};

const handleActionCallback = async (
	token: string,
	channelId: string,
	callback: TelegramCallbackQuery,
) => {
	const answer = (text?: string) =>
		telegramApi(token, "answerCallbackQuery", {
			callback_query_id: callback.id,
			...(text ? { text } : {}),
		}).catch(() => {});

	try {
		const [, actionId, verdict] = (callback.data || "").split(":");
		if (!actionId) {
			await answer();
			return;
		}

		// Only allowlisted users may decide, and only from the chat the
		// confirmation was sent to.
		const { findChannelById, findPendingActionById } = await import(
			"@dokploy/server/services/agent"
		);
		const channel = await findChannelById(channelId);
		const allowlist = parseAllowlist(channel.allowedIdentifiers);
		if (
			!matchesAllowlist(allowlist, [callback.from?.id, callback.from?.username])
		) {
			await answer("You are not allowed to decide this action.");
			return;
		}
		const action = await findPendingActionById(actionId);
		if (
			action.channelId !== channelId ||
			(action.externalChatId &&
				String(callback.message?.chat.id) !== action.externalChatId)
		) {
			await answer("This action does not belong to this chat.");
			return;
		}

		const { resolvePendingAction } = await import("../pending");
		const actor = callback.from?.username
			? `@${callback.from.username}`
			: String(callback.from?.id ?? "user");
		const resolved = await resolvePendingAction(
			actionId,
			verdict === "y",
			actor,
		);
		await answer();

		if (callback.message) {
			const icon =
				resolved.status === "approved"
					? "✅ Approved"
					: resolved.status === "rejected"
						? "❌ Rejected"
						: `⌛ ${resolved.status}`;
			// Replace the buttons with the outcome so they can't be tapped twice.
			await telegramApi(token, "editMessageText", {
				chat_id: callback.message.chat.id,
				message_id: callback.message.message_id,
				text: `${icon} by ${actor}\n\n${resolved.summary}`,
			}).catch(() => {});
			await sendMessage(token, callback.message.chat.id, resolved.text);
		}
	} catch (error) {
		console.error(
			"[agent-gateway] Failed to process Telegram confirmation:",
			error instanceof Error ? error.message : error,
		);
		await answer("Failed to process this action.");
	}
};

export const startTelegram = ({
	channelId,
	agentId,
	credentials,
	onFatal,
}: GatewayStartInput): GatewayHandle => {
	const token = credentials.botToken || "";
	let stopped = false;
	let abort: AbortController | null = null;

	const loop = async () => {
		let offset = 0;
		// Best-effort: publish the shared agent commands in Telegram's menu.
		void telegramApi(token, "setMyCommands", {
			commands: [
				{ command: "new", description: "Start a fresh conversation" },
				{ command: "status", description: "Show the active session" },
				{ command: "whoami", description: "Show your gateway identity" },
				{ command: "sessions", description: "List previous sessions" },
				{ command: "resume", description: "Resume a session by id or title" },
				{ command: "title", description: "Rename the active session" },
				{ command: "undo", description: "Remove the last exchange" },
				{ command: "retry", description: "Retry the last request" },
				{ command: "skills", description: "List reusable agent skills" },
				{ command: "learn", description: "Teach the agent a workflow" },
				{ command: "approve", description: "Approve a pending action" },
				{ command: "deny", description: "Reject a pending action" },
				{ command: "help", description: "Show what the agent can do" },
			],
		}).catch(() => {});
		// Skip updates queued while the gateway was down so the bot doesn't
		// replay old commands after a restart.
		try {
			const pending = (await telegramApi(token, "getUpdates", {
				timeout: 0,
				offset: -1,
			})) as TelegramUpdate[];
			if (pending.length > 0) {
				offset = (pending[pending.length - 1]?.update_id ?? -1) + 1;
			}
		} catch {
			// surfaced by the main loop below
		}

		while (!stopped) {
			try {
				abort = new AbortController();
				const updates = (await telegramApi(
					token,
					"getUpdates",
					{
						timeout: 50,
						offset,
						allowed_updates: ["message", "callback_query"],
					},
					abort.signal,
				)) as TelegramUpdate[];

				for (const update of updates) {
					offset = update.update_id + 1;
					if (stopped) break;
					const callback = update.callback_query;
					if (callback?.data?.startsWith(CALLBACK_PREFIX)) {
						await handleActionCallback(token, channelId, callback);
						continue;
					}
					const message = update.message;
					if (!message?.text) continue;

					const typing = setInterval(() => {
						void telegramApi(token, "sendChatAction", {
							chat_id: message.chat.id,
							action: "typing",
						}).catch(() => {});
					}, 4500);
					void telegramApi(token, "sendChatAction", {
						chat_id: message.chat.id,
						action: "typing",
					}).catch(() => {});

					try {
						await dispatchMessage({
							agentId,
							channelId,
							source: "telegram",
							externalChatId: String(message.chat.id),
							text: message.text,
							identifiers: [message.from?.id, message.from?.username],
							reply: (text) => sendMessage(token, message.chat.id, text),
							sendProgress: (text) => sendMessage(token, message.chat.id, text),
							sendConfirmation: ({ actionId, summary }) =>
								sendConfirmationButtons(
									token,
									message.chat.id,
									actionId,
									summary,
								),
						});
					} finally {
						clearInterval(typing);
					}
				}
			} catch (error) {
				if (stopped) break;
				const code = (error as { errorCode?: number }).errorCode;
				if (code === 401 || code === 404) {
					console.error(
						`[agent-gateway] Telegram token rejected for channel ${channelId}`,
					);
					onFatal?.(
						"Telegram rejected the bot token. Save a valid token to restart the gateway.",
					);
					break;
				}
				// 409 means another process is polling this bot; back off harder.
				await sleep(code === 409 ? 30_000 : 5_000);
			}
		}
	};

	void loop();

	return {
		stop: () => {
			stopped = true;
			abort?.abort();
		},
	};
};
