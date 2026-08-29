import WebSocket from "ws";
import { chunkText, dispatchMessage } from "./dispatch";
import type { GatewayHandle, GatewayStartInput } from "./types";

const API = "https://slack.com/api";

const slackApi = async (
	token: string,
	method: string,
	body?: Record<string, unknown>,
) => {
	const response = await fetch(`${API}/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json; charset=utf-8",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const payload = (await response.json()) as {
		ok: boolean;
		error?: string;
		url?: string;
		[key: string]: unknown;
	};
	if (!payload.ok) {
		throw new Error(
			`Slack ${method} failed: ${payload.error || response.status}`,
		);
	}
	return payload;
};

export const getSlackBotInfo = async (botToken: string, appToken: string) => {
	const auth = (await slackApi(botToken, "auth.test")) as {
		team?: string;
		user?: string;
	};
	// Verify the app-level token can actually open a Socket Mode connection.
	await slackApi(appToken, "apps.connections.open");
	return { team: auth.team ?? "", user: auth.user ?? "" };
};

const sendMessage = async (token: string, channel: string, text: string) => {
	for (const chunk of chunkText(text, 3500)) {
		await slackApi(token, "chat.postMessage", { channel, text: chunk });
	}
};

export const startSlack = ({
	channelId,
	agentId,
	credentials,
}: GatewayStartInput): GatewayHandle => {
	const botToken = credentials.botToken || "";
	const appToken = credentials.appToken || "";
	let stopped = false;
	let socket: WebSocket | null = null;
	let reconnectTimer: NodeJS.Timeout | null = null;

	const connect = async () => {
		if (stopped) return;
		try {
			const { url } = (await slackApi(appToken, "apps.connections.open")) as {
				url: string;
			};
			socket = new WebSocket(url);

			socket.on("message", async (raw) => {
				let envelope: any;
				try {
					envelope = JSON.parse(raw.toString());
				} catch {
					return;
				}

				// Socket Mode requires acking every envelope by id.
				if (envelope.envelope_id) {
					socket?.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
				}
				if (envelope.type !== "events_api") return;

				const event = envelope.payload?.event;
				if (!event) return;
				if (event.type !== "message" && event.type !== "app_mention") return;
				// Ignore edits, joins and the bot's own messages.
				if (event.subtype || event.bot_id) return;

				const text: string = event.text || "";
				if (!text.trim()) return;

				await dispatchMessage({
					agentId,
					channelId,
					source: "slack",
					externalChatId: String(event.channel),
					text,
					identifiers: [event.user],
					reply: (reply) => sendMessage(botToken, event.channel, reply),
					sendProgress: (progress) =>
						sendMessage(botToken, event.channel, progress),
				});
			});

			socket.on("close", () => {
				if (stopped) return;
				reconnectTimer = setTimeout(() => void connect(), 5_000);
			});
			socket.on("error", () => {});
		} catch (error) {
			if (stopped) return;
			console.error(
				`[agent-gateway] Slack connection failed for channel ${channelId}:`,
				error instanceof Error ? error.message : error,
			);
			reconnectTimer = setTimeout(() => void connect(), 30_000);
		}
	};

	void connect();

	return {
		stop: () => {
			stopped = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			socket?.close();
		},
	};
};
