import { dispatchMessage } from "./dispatch";
import type { GatewayHandle, GatewayStartInput } from "./types";
import { sleep } from "./types";

/**
 * Signal has no official bot API, so this talks to a signal-cli-rest-api
 * instance (bbernhard/signal-cli-rest-api) that the user runs themselves —
 * conveniently, as a Dokploy service.
 */
const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, "");

export const getSignalInfo = async (apiUrl: string, number: string) => {
	const base = normalizeUrl(apiUrl);
	const response = await fetch(`${base}/v1/accounts`);
	if (!response.ok) {
		throw new Error(
			`signal-cli-rest-api did not respond at ${base} (${response.status}).`,
		);
	}
	const accounts = (await response.json()) as string[];
	const registered = Array.isArray(accounts) && accounts.includes(number);
	if (!registered) {
		throw new Error(
			`${number} is not registered on that signal-cli instance. Registered: ${
				Array.isArray(accounts) ? accounts.join(", ") || "none" : "unknown"
			}`,
		);
	}
	return { accounts };
};

const sendMessage = async (
	apiUrl: string,
	number: string,
	recipient: string,
	text: string,
) => {
	await fetch(`${normalizeUrl(apiUrl)}/v2/send`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			message: text,
			number,
			recipients: [recipient],
		}),
	});
};

export const startSignal = ({
	channelId,
	agentId,
	credentials,
}: GatewayStartInput): GatewayHandle => {
	const apiUrl = normalizeUrl(credentials.apiUrl || "");
	const number = credentials.number || "";
	let stopped = false;

	const loop = async () => {
		while (!stopped) {
			try {
				const response = await fetch(
					`${apiUrl}/v1/receive/${encodeURIComponent(number)}`,
				);
				if (!response.ok) {
					await sleep(15_000);
					continue;
				}
				const envelopes = (await response.json()) as any[];
				for (const item of envelopes ?? []) {
					if (stopped) break;
					const envelope = item?.envelope;
					const text: string = envelope?.dataMessage?.message || "";
					const sender: string =
						envelope?.sourceNumber || envelope?.source || "";
					if (!text.trim() || !sender) continue;

					await dispatchMessage({
						agentId,
						channelId,
						source: "signal",
						externalChatId: sender,
						text,
						identifiers: [sender],
						reply: (reply) => sendMessage(apiUrl, number, sender, reply),
						sendProgress: (progress) =>
							sendMessage(apiUrl, number, sender, progress),
					});
				}
				await sleep(2_000);
			} catch {
				if (stopped) break;
				await sleep(15_000);
			}
		}
	};

	void loop();

	return {
		stop: () => {
			stopped = true;
		},
	};
};
