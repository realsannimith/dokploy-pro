import { chunkText, dispatchMessage } from "./dispatch";
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

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
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
	for (const chunk of chunkText(text, 4000)) {
		await telegramApi(token, "sendMessage", {
			chat_id: chatId,
			text: chunk,
			link_preview_options: { is_disabled: true },
		});
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
					{ timeout: 50, offset, allowed_updates: ["message"] },
					abort.signal,
				)) as TelegramUpdate[];

				for (const update of updates) {
					offset = update.update_id + 1;
					if (stopped) break;
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
