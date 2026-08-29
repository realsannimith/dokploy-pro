import type { NextApiRequest, NextApiResponse } from "next";
import {
	handleWhatsappWebhook,
	verifyWhatsappWebhook,
} from "@/server/agent/gateways/whatsapp";

/**
 * Meta WhatsApp Cloud API webhook. Point the app's callback URL at
 * https://<your-dokploy-domain>/api/agent/whatsapp and use the same verify
 * token configured on the channel.
 */
const handler = async (req: NextApiRequest, res: NextApiResponse) => {
	if (req.method === "GET") {
		const challenge = await verifyWhatsappWebhook({
			mode: req.query["hub.mode"] as string,
			token: req.query["hub.verify_token"] as string,
			challenge: req.query["hub.challenge"] as string,
		});
		if (challenge === null) {
			res.status(403).send("Forbidden");
			return;
		}
		res.status(200).send(challenge);
		return;
	}

	if (req.method !== "POST") {
		res.status(405).json({ error: "Method not allowed" });
		return;
	}

	// Meta retries on any non-200, so ack first and process afterwards.
	res.status(200).json({ received: true });
	try {
		await handleWhatsappWebhook(req.body);
	} catch (error) {
		console.error("[agent-gateway] WhatsApp webhook failed", error);
	}
};

export default handler;
