import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { dispatchMessage } from "./dispatch";
import type { GatewayHandle, GatewayStartInput } from "./types";
import { sleep } from "./types";

const POLL_INTERVAL = 20_000;

const buildImapClient = (credentials: GatewayStartInput["credentials"]) =>
	new ImapFlow({
		host: credentials.imapHost || "",
		port: credentials.imapPort || 993,
		secure: true,
		auth: {
			user: credentials.imapUser || "",
			pass: credentials.imapPassword || "",
		},
		logger: false,
	});

const buildTransport = (credentials: GatewayStartInput["credentials"]) =>
	nodemailer.createTransport({
		host: credentials.smtpHost || "",
		port: credentials.smtpPort || 587,
		secure: credentials.smtpSecure ?? false,
		auth:
			credentials.smtpUser || credentials.smtpPassword
				? {
						user: credentials.smtpUser || credentials.imapUser || "",
						pass: credentials.smtpPassword || credentials.imapPassword || "",
					}
				: undefined,
	});

export const verifyEmailChannel = async (
	credentials: GatewayStartInput["credentials"],
) => {
	const client = buildImapClient(credentials);
	await client.connect();
	await client.logout();
	await buildTransport(credentials).verify();
	return { mailbox: "INBOX" };
};

/** Strips quoted replies so the model only sees what the sender just wrote. */
const stripQuotedReply = (body: string) => {
	const lines = body.split(/\r?\n/);
	const cut = lines.findIndex(
		(line) =>
			/^\s*>/.test(line) ||
			/^\s*On .+ wrote:\s*$/.test(line) ||
			/^-{2,}\s*Original Message\s*-{2,}/i.test(line),
	);
	return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
};

export const startEmail = ({
	channelId,
	agentId,
	credentials,
}: GatewayStartInput): GatewayHandle => {
	let stopped = false;
	const fromAddress =
		credentials.fromAddress ||
		credentials.smtpUser ||
		credentials.imapUser ||
		"";

	const sendReply = async (to: string, subject: string, text: string) => {
		await buildTransport(credentials).sendMail({
			from: fromAddress,
			to,
			subject: subject.toLowerCase().startsWith("re:")
				? subject
				: `Re: ${subject}`,
			text,
		});
	};

	const loop = async () => {
		while (!stopped) {
			let client: ImapFlow | null = null;
			try {
				client = buildImapClient(credentials);
				await client.connect();
				const lock = await client.getMailboxLock("INBOX");
				try {
					const unseen = await client.search({ seen: false });
					for (const uid of (unseen || []).slice(0, 10)) {
						if (stopped) break;
						const message = await client.fetchOne(String(uid), {
							envelope: true,
							source: true,
						});
						if (!message) continue;

						const sender = message.envelope?.from?.[0]?.address || "";
						const subject = message.envelope?.subject || "Dokploy agent";
						const raw = message.source?.toString() || "";
						// Body is everything after the header block.
						const separator = raw.indexOf("\r\n\r\n");
						const body = separator === -1 ? raw : raw.slice(separator + 4);
						const text = stripQuotedReply(body).slice(0, 4000);

						// Mark seen first so a crash mid-run cannot loop on one mail.
						await client.messageFlagsAdd(String(uid), ["\\Seen"]);
						if (!sender || !text) continue;

						await dispatchMessage({
							agentId,
							channelId,
							source: "email",
							externalChatId: sender,
							text,
							identifiers: [sender],
							reply: (reply) => sendReply(sender, subject, reply),
							// Never auto-reply to unknown senders: an inbox receives
							// spam, and bouncing a notice back to a forged address
							// would make this a backscatter source.
							onUnauthorized: async () => {
								console.warn(
									`[agent-gateway] Ignored email from unauthorized sender ${sender}`,
								);
							},
						});
					}
				} finally {
					lock.release();
				}
				await client.logout();
				client = null;
			} catch (error) {
				if (!stopped) {
					console.error(
						`[agent-gateway] Email poll failed for channel ${channelId}:`,
						error instanceof Error ? error.message : error,
					);
				}
				try {
					await client?.logout();
				} catch {
					// connection already broken
				}
			}
			await sleep(POLL_INTERVAL);
		}
	};

	void loop();

	return {
		stop: () => {
			stopped = true;
		},
	};
};
