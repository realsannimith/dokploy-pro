import WebSocket from "ws";
import { chunkText, dispatchMessage } from "./dispatch";
import type { GatewayHandle, GatewayStartInput } from "./types";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const API = "https://discord.com/api/v10";

// GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
const INTENTS = 1 | 512 | 4096 | 32768;

interface DiscordPayload {
	op: number;
	d?: any;
	s?: number | null;
	t?: string | null;
}

export const getDiscordBotInfo = async (token: string) => {
	const response = await fetch(`${API}/users/@me`, {
		headers: { Authorization: `Bot ${token}` },
	});
	if (!response.ok) {
		throw new Error(
			`Discord rejected the bot token (${response.status}). Check the token in the Discord developer portal.`,
		);
	}
	return (await response.json()) as { id: string; username: string };
};

const sendMessage = async (token: string, channelId: string, text: string) => {
	for (const chunk of chunkText(text, 1900)) {
		await fetch(`${API}/channels/${channelId}/messages`, {
			method: "POST",
			headers: {
				Authorization: `Bot ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ content: chunk }),
		});
	}
};

export const startDiscord = ({
	channelId,
	agentId,
	credentials,
	onFatal,
}: GatewayStartInput): GatewayHandle => {
	const token = credentials.botToken || "";
	let stopped = false;
	let socket: WebSocket | null = null;
	let heartbeat: NodeJS.Timeout | null = null;
	let reconnectTimer: NodeJS.Timeout | null = null;
	let sequence: number | null = null;

	const connect = () => {
		if (stopped) return;
		socket = new WebSocket(GATEWAY_URL);

		socket.on("message", async (raw) => {
			let payload: DiscordPayload;
			try {
				payload = JSON.parse(raw.toString());
			} catch {
				return;
			}
			if (payload.s !== undefined && payload.s !== null) sequence = payload.s;

			if (payload.op === 10) {
				const interval = payload.d?.heartbeat_interval ?? 45_000;
				heartbeat = setInterval(() => {
					socket?.send(JSON.stringify({ op: 1, d: sequence }));
				}, interval);
				socket?.send(
					JSON.stringify({
						op: 2,
						d: {
							token,
							intents: INTENTS,
							properties: {
								os: "linux",
								browser: "dokploy",
								device: "dokploy",
							},
						},
					}),
				);
				return;
			}

			if (payload.op === 0 && payload.t === "MESSAGE_CREATE") {
				const message = payload.d;
				if (!message || message.author?.bot) return;
				const text: string = message.content || "";
				if (!text.trim()) return;

				await dispatchMessage({
					agentId,
					channelId,
					source: "discord",
					externalChatId: String(message.channel_id),
					text,
					identifiers: [message.author?.id, message.author?.username],
					reply: (reply) => sendMessage(token, message.channel_id, reply),
					sendProgress: (progress) =>
						sendMessage(token, message.channel_id, progress),
				});
			}
		});

		socket.on("close", (code) => {
			if (heartbeat) clearInterval(heartbeat);
			heartbeat = null;
			if (stopped) return;
			// 4004 = authentication failed; retrying would just loop forever.
			if (code === 4004) {
				console.error(
					`[agent-gateway] Discord token rejected for channel ${channelId}`,
				);
				onFatal?.(
					"Discord rejected the bot token. Save a valid token to restart the gateway.",
				);
				return;
			}
			reconnectTimer = setTimeout(connect, 5_000);
		});

		socket.on("error", () => {
			// close handler performs the reconnect
		});
	};

	connect();

	return {
		stop: () => {
			stopped = true;
			if (heartbeat) clearInterval(heartbeat);
			if (reconnectTimer) clearTimeout(reconnectTimer);
			socket?.close();
		},
	};
};
