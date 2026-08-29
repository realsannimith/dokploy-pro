import { dispatchMessage } from "./dispatch";

const GRAPH = "https://graph.facebook.com/v21.0";

export const getWhatsappInfo = async (
	accessToken: string,
	phoneNumberId: string,
) => {
	const response = await fetch(
		`${GRAPH}/${phoneNumberId}?fields=display_phone_number,verified_name`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);
	const payload = (await response.json()) as {
		display_phone_number?: string;
		verified_name?: string;
		error?: { message?: string };
	};
	if (!response.ok) {
		throw new Error(
			payload.error?.message || `WhatsApp API returned ${response.status}`,
		);
	}
	return {
		number: payload.display_phone_number || "",
		name: payload.verified_name || "",
	};
};

const sendMessage = async (
	accessToken: string,
	phoneNumberId: string,
	to: string,
	text: string,
) => {
	// WhatsApp caps a text body at 4096 characters.
	for (let i = 0; i < text.length; i += 4000) {
		await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messaging_product: "whatsapp",
				to,
				type: "text",
				text: { body: text.slice(i, i + 4000) },
			}),
		});
	}
};

/** GET handshake: Meta echoes the challenge when the verify token matches. */
export const verifyWhatsappWebhook = async (query: {
	mode?: string;
	token?: string;
	challenge?: string;
}) => {
	if (query.mode !== "subscribe" || !query.token) return null;
	const { findChannelsByType } = await import("@dokploy/server/services/agent");
	const channels = await findChannelsByType("whatsapp");
	const match = channels.find(
		(channel) => channel.credentials.verifyToken === query.token,
	);
	return match ? (query.challenge ?? "") : null;
};

export const handleWhatsappWebhook = async (body: any) => {
	const { findChannelsByType } = await import("@dokploy/server/services/agent");

	for (const entry of body?.entry ?? []) {
		for (const change of entry?.changes ?? []) {
			const value = change?.value;
			const phoneNumberId = value?.metadata?.phone_number_id;
			if (!phoneNumberId) continue;

			const channels = await findChannelsByType("whatsapp");
			const channel = channels.find(
				(candidate) =>
					candidate.credentials.phoneNumberId === String(phoneNumberId) &&
					candidate.isEnabled,
			);
			if (!channel) continue;

			const accessToken = channel.credentials.accessToken || "";
			for (const message of value?.messages ?? []) {
				const text: string = message?.text?.body || "";
				const from: string = message?.from || "";
				if (!text.trim() || !from) continue;

				await dispatchMessage({
					agentId: channel.agentId,
					channelId: channel.channelId,
					source: "whatsapp",
					externalChatId: from,
					text,
					identifiers: [from],
					reply: (reply) =>
						sendMessage(accessToken, String(phoneNumberId), from, reply),
				});
			}
		}
	}
};
