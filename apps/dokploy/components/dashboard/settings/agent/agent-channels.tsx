"use client";
import type { AgentChannelCredentials } from "@dokploy/server/db/schema/agent";
import {
	ExternalLink,
	Loader2,
	MessageCircle,
	Plug,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { DialogAction } from "@/components/shared/dialog-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/utils/api";
import { useUrl } from "@/utils/hooks/use-url";

type ChannelType =
	| "telegram"
	| "discord"
	| "slack"
	| "whatsapp"
	| "signal"
	| "email";

interface FieldDef {
	key: keyof AgentChannelCredentials;
	label: string;
	placeholder?: string;
	secret?: boolean;
	type?: "text" | "number";
}

interface ChannelDef {
	type: ChannelType;
	name: string;
	description: string;
	setup: string;
	identifierLabel: string;
	identifierHint: string;
	fields: FieldDef[];
	webhook?: boolean;
}

const CHANNELS: ChannelDef[] = [
	{
		type: "telegram",
		name: "Telegram",
		description: "Chat with the agent from Telegram.",
		setup: "Create a bot with @BotFather and paste its token.",
		identifierLabel: "Allowed Telegram users",
		identifierHint:
			"Comma-separated user IDs or @usernames. Message the bot once and it replies with your ID.",
		fields: [
			{
				key: "botToken",
				label: "Bot token",
				secret: true,
				placeholder: "123456789:AA...",
			},
		],
	},
	{
		type: "discord",
		name: "Discord",
		description: "Chat with the agent in a Discord server or DM.",
		setup:
			"Create an application at discord.com/developers, add a bot, enable the Message Content intent, then invite it to your server.",
		identifierLabel: "Allowed Discord users",
		identifierHint:
			"Comma-separated user IDs or usernames. Enable Developer Mode in Discord to copy a user ID.",
		fields: [{ key: "botToken", label: "Bot token", secret: true }],
	},
	{
		type: "slack",
		name: "Slack",
		description: "Chat with the agent from Slack via Socket Mode.",
		setup:
			"Create a Slack app, enable Socket Mode, subscribe to message.channels and message.im, then copy both tokens.",
		identifierLabel: "Allowed Slack users",
		identifierHint:
			"Comma-separated Slack member IDs (they look like U01ABCDEF).",
		fields: [
			{ key: "botToken", label: "Bot token (xoxb-)", secret: true },
			{ key: "appToken", label: "App-level token (xapp-)", secret: true },
		],
	},
	{
		type: "whatsapp",
		name: "WhatsApp",
		description: "Chat with the agent over the WhatsApp Cloud API.",
		setup:
			"Create a Meta app with WhatsApp, then set the webhook callback URL below and use the same verify token.",
		identifierLabel: "Allowed phone numbers",
		identifierHint:
			"Comma-separated numbers in international format without +, e.g. 855123456789.",
		webhook: true,
		fields: [
			{ key: "accessToken", label: "Access token", secret: true },
			{ key: "phoneNumberId", label: "Phone number ID" },
			{ key: "verifyToken", label: "Webhook verify token", secret: true },
		],
	},
	{
		type: "signal",
		name: "Signal",
		description: "Chat with the agent over Signal.",
		setup:
			"Signal has no official bot API — deploy bbernhard/signal-cli-rest-api (you can host it right here in Dokploy), register your number, then point this at it.",
		identifierLabel: "Allowed phone numbers",
		identifierHint:
			"Comma-separated numbers in international format, e.g. +855123456789.",
		fields: [
			{
				key: "apiUrl",
				label: "signal-cli-rest-api URL",
				placeholder: "http://signal-api:8080",
			},
			{
				key: "number",
				label: "Agent phone number",
				placeholder: "+855123456789",
			},
		],
	},
	{
		type: "email",
		name: "Email",
		description: "Email the agent and get a reply in the thread.",
		setup:
			"Use a dedicated mailbox. The agent polls IMAP for unread mail and replies over SMTP.",
		identifierLabel: "Allowed senders",
		identifierHint:
			"Comma-separated email addresses allowed to command the agent.",
		fields: [
			{ key: "imapHost", label: "IMAP host", placeholder: "imap.gmail.com" },
			{
				key: "imapPort",
				label: "IMAP port",
				placeholder: "993",
				type: "number",
			},
			{ key: "imapUser", label: "IMAP user" },
			{ key: "imapPassword", label: "IMAP password", secret: true },
			{ key: "smtpHost", label: "SMTP host", placeholder: "smtp.gmail.com" },
			{
				key: "smtpPort",
				label: "SMTP port",
				placeholder: "587",
				type: "number",
			},
			{ key: "fromAddress", label: "From address" },
		],
	},
];

const ChannelCard = ({ def }: { def: ChannelDef }) => {
	const url = useUrl();
	const { data: channels, refetch } = api.agent.channels.useQuery();
	const { mutateAsync: saveChannel, isPending: isSaving } =
		api.agent.saveChannel.useMutation();
	const { mutateAsync: testChannel, isPending: isTesting } =
		api.agent.testChannel.useMutation();
	const { mutateAsync: deleteChannel } = api.agent.deleteChannel.useMutation();

	const channel = channels?.find((item) => item.type === def.type);
	const [isEnabled, setIsEnabled] = useState(false);
	const [allowed, setAllowed] = useState("");
	const [values, setValues] = useState<Record<string, string>>({});
	const [testResult, setTestResult] = useState<{
		label: string;
		url?: string;
	} | null>(null);

	useEffect(() => {
		setIsEnabled(channel?.isEnabled ?? false);
		setAllowed(channel?.allowedIdentifiers ?? "");
		const next: Record<string, string> = {};
		for (const field of def.fields) {
			const stored = channel?.credentials?.[field.key];
			// Secrets are stored but never echoed back into the form.
			next[field.key] =
				field.secret && stored ? "" : stored != null ? String(stored) : "";
		}
		setValues(next);
	}, [channel]);

	const buildCredentials = () => {
		const credentials: Record<string, unknown> = {};
		for (const field of def.fields) {
			const raw = values[field.key]?.trim();
			if (!raw) continue;
			credentials[field.key] = field.type === "number" ? Number(raw) : raw;
		}
		return credentials;
	};

	const payload = () => ({
		channelId: channel?.channelId,
		type: def.type,
		isEnabled,
		credentials: buildCredentials(),
		allowedIdentifiers: allowed,
	});

	const handleSave = async () => {
		try {
			await saveChannel(payload());
			await refetch();
			toast.success(`${def.name} settings saved`);
		} catch (error) {
			toast.error(`Failed to save ${def.name}`, {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const handleTest = async () => {
		try {
			const result = await testChannel(payload());
			setTestResult(result ?? null);
			toast.success(`${def.name} connected`);
		} catch (error) {
			setTestResult(null);
			toast.error(`${def.name} connection failed`, {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const handleDelete = async () => {
		if (!channel) return;
		try {
			await deleteChannel({ channelId: channel.channelId });
			await refetch();
			toast.success(`${def.name} disconnected`);
		} catch {
			toast.error(`Failed to disconnect ${def.name}`);
		}
	};

	const hasSecrets = def.fields.some(
		(field) => field.secret && channel?.credentials?.[field.key],
	);

	return (
		<div className="rounded-lg border p-4 flex flex-col gap-4">
			<div className="flex items-start justify-between gap-4">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<span className="font-medium">{def.name}</span>
						{channel?.isEnabled && <Badge variant="outline">Active</Badge>}
					</div>
					<p className="text-sm text-muted-foreground">{def.description}</p>
					<p className="text-xs text-muted-foreground">{def.setup}</p>
				</div>
				<Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
			</div>

			{def.webhook && (
				<div className="space-y-1">
					<Label className="text-xs">Webhook callback URL</Label>
					<code className="block rounded bg-muted px-2 py-1.5 text-xs break-all">
						{url}/api/agent/whatsapp
					</code>
				</div>
			)}

			<div className="grid md:grid-cols-2 gap-3">
				{def.fields.map((field) => (
					<div key={field.key} className="space-y-1">
						<Label className="text-xs">{field.label}</Label>
						<Input
							type={
								field.secret
									? "password"
									: field.type === "number"
										? "number"
										: "text"
							}
							value={values[field.key] ?? ""}
							placeholder={
								field.secret && channel?.credentials?.[field.key]
									? "•••••••• (saved)"
									: field.placeholder
							}
							onChange={(event) =>
								setValues((prev) => ({
									...prev,
									[field.key]: event.target.value,
								}))
							}
						/>
					</div>
				))}
			</div>

			<div className="space-y-1">
				<Label className="text-xs">{def.identifierLabel}</Label>
				<Input
					value={allowed}
					onChange={(event) => setAllowed(event.target.value)}
					placeholder="nobody is allowed until you add someone"
				/>
				<p className="text-xs text-muted-foreground">{def.identifierHint}</p>
			</div>

			<div className="flex items-center gap-2 flex-wrap">
				<Button size="sm" onClick={handleSave} disabled={isSaving}>
					{isSaving && <Loader2 className="size-4 animate-spin" />}
					Save
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={handleTest}
					disabled={isTesting}
				>
					{isTesting ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Plug className="size-4" />
					)}
					Test connection
				</Button>
				{channel && (
					<DialogAction
						title={`Disconnect ${def.name}`}
						description="This removes the stored credentials for this channel."
						type="destructive"
						onClick={handleDelete}
					>
						<Button size="sm" variant="ghost">
							<Trash2 className="size-4" />
						</Button>
					</DialogAction>
				)}
				{testResult && (
					<span className="text-sm text-muted-foreground flex items-center gap-1">
						{testResult.url ? (
							<a
								href={testResult.url}
								target="_blank"
								rel="noreferrer"
								className="text-primary flex items-center gap-1"
							>
								{testResult.label} <ExternalLink className="size-3.5" />
							</a>
						) : (
							testResult.label
						)}
					</span>
				)}
				{hasSecrets && (
					<span className="text-xs text-muted-foreground">
						Leave secret fields blank to keep the saved values.
					</span>
				)}
			</div>
		</div>
	);
};

export const AgentChannels = () => {
	const { data: agent } = api.agent.get.useQuery();

	return (
		<Card className="rounded-lg w-full bg-sidebar p-2.5">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader>
					<CardTitle className="text-xl flex items-center gap-2">
						<MessageCircle className="size-5" />
						Chat gateways
					</CardTitle>
					<CardDescription>
						Connect the agent to the chat apps you already use. Each gateway has
						its own allowlist, and nobody can talk to the agent until you add
						them.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{!agent && (
						<AlertBlock type="info">
							Save the agent settings above once before connecting a gateway.
						</AlertBlock>
					)}
					{agent && !agent.isEnabled && (
						<AlertBlock type="warning">
							The agent is disabled, so no gateway is running. Enable it above.
						</AlertBlock>
					)}
					{agent &&
						CHANNELS.map((def) => <ChannelCard key={def.type} def={def} />)}
				</CardContent>
			</div>
		</Card>
	);
};
