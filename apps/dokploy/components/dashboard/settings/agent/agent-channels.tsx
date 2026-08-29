"use client";
import type { AgentChannelCredentials } from "@dokploy/server/db/schema/agent";
import {
	ExternalLink,
	Hash,
	Loader2,
	type LucideIcon,
	Mail,
	MessageCircle,
	MessagesSquare,
	Phone,
	Plug,
	Plus,
	Send,
	Settings2,
	ShieldCheck,
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, type RouterOutputs } from "@/utils/api";
import { useUrl } from "@/utils/hooks/use-url";

type AgentChannel = RouterOutputs["agent"]["channels"][number];

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
	icon: LucideIcon;
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
		icon: Send,
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
		icon: MessagesSquare,
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
		icon: Hash,
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
		icon: Phone,
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
		icon: ShieldCheck,
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
		icon: Mail,
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

const countAllowed = (raw?: string | null) =>
	(raw || "").split(/[\s,]+/).filter(Boolean).length;

const StatusBadge = ({
	def,
	channel,
	agentEnabled,
}: {
	def: ChannelDef;
	channel: AgentChannel;
	agentEnabled: boolean;
}) => {
	if (!channel.isEnabled) {
		return <Badge variant="blank">Off</Badge>;
	}
	if (!agentEnabled) {
		return <Badge variant="yellow">Waiting — agent disabled</Badge>;
	}
	if (def.webhook) {
		return <Badge variant="green">Webhook listening</Badge>;
	}
	if (channel.runtime.state === "running") {
		return <Badge variant="green">Running</Badge>;
	}
	if (channel.runtime.state === "error") {
		return <Badge variant="red">Error</Badge>;
	}
	return <Badge variant="blank">Stopped</Badge>;
};

const ChannelRow = ({
	def,
	channel,
	agentEnabled,
	onConfigure,
}: {
	def: ChannelDef;
	channel: AgentChannel;
	agentEnabled: boolean;
	onConfigure: () => void;
}) => {
	const utils = api.useUtils();
	const { mutateAsync: saveChannel, isPending: isToggling } =
		api.agent.saveChannel.useMutation();

	const allowedCount = countAllowed(channel.allowedIdentifiers);
	const Icon = def.icon;

	const handleToggle = async (checked: boolean) => {
		try {
			// Empty credentials merge with the stored ones server-side.
			await saveChannel({
				channelId: channel.channelId,
				type: def.type,
				isEnabled: checked,
				credentials: {},
				allowedIdentifiers: channel.allowedIdentifiers ?? "",
			});
			await utils.agent.channels.invalidate();
			toast.success(checked ? `${def.name} enabled` : `${def.name} disabled`);
		} catch (error) {
			toast.error(`Failed to update ${def.name}`, {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	return (
		<div className="rounded-lg border p-4 flex flex-col gap-2">
			<div className="flex items-center gap-4">
				<Icon className="size-5 text-muted-foreground shrink-0" />
				<div className="flex-1 min-w-0 space-y-0.5">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="font-medium">{def.name}</span>
						<StatusBadge
							def={def}
							channel={channel}
							agentEnabled={agentEnabled}
						/>
					</div>
					<p className="text-sm text-muted-foreground truncate">
						{allowedCount > 0
							? `${allowedCount} allowed ${allowedCount === 1 ? "user" : "users"}`
							: "Nobody is allowed yet — add allowed users in Configure"}
					</p>
				</div>
				<Button size="sm" variant="outline" onClick={onConfigure}>
					<Settings2 className="size-4" />
					Configure
				</Button>
				<Switch
					checked={channel.isEnabled}
					disabled={isToggling}
					onCheckedChange={handleToggle}
				/>
			</div>
			{channel.isEnabled && channel.runtime.state === "error" && (
				<p className="text-xs text-destructive pl-9">
					{channel.runtime.message || "The gateway stopped unexpectedly."}
				</p>
			)}
		</div>
	);
};

const ChannelConfigDialog = ({
	def,
	channel,
	onClose,
}: {
	def: ChannelDef;
	channel?: AgentChannel;
	onClose: () => void;
}) => {
	const url = useUrl();
	const utils = api.useUtils();
	const { mutateAsync: saveChannel, isPending: isSaving } =
		api.agent.saveChannel.useMutation();
	const { mutateAsync: testChannel, isPending: isTesting } =
		api.agent.testChannel.useMutation();
	const { mutateAsync: deleteChannel } = api.agent.deleteChannel.useMutation();

	const [isEnabled, setIsEnabled] = useState(true);
	const [allowed, setAllowed] = useState("");
	const [values, setValues] = useState<Record<string, string>>({});
	const [testResult, setTestResult] = useState<{
		label: string;
		url?: string;
	} | null>(null);

	useEffect(() => {
		setIsEnabled(channel?.isEnabled ?? true);
		setAllowed(channel?.allowedIdentifiers ?? "");
		const next: Record<string, string> = {};
		for (const field of def.fields) {
			const stored = channel?.credentials?.[field.key];
			// Secrets are stored but never echoed back into the form.
			next[field.key] =
				field.secret && stored ? "" : stored != null ? String(stored) : "";
		}
		setValues(next);
		setTestResult(null);
	}, [channel, def]);

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
			await utils.agent.channels.invalidate();
			toast.success(`${def.name} settings saved`);
			onClose();
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
			await utils.agent.channels.invalidate();
			toast.success(`${def.name} disconnected`);
			onClose();
		} catch {
			toast.error(`Failed to disconnect ${def.name}`);
		}
	};

	const hasSecrets = def.fields.some(
		(field) => field.secret && channel?.credentials?.[field.key],
	);
	const Icon = def.icon;

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Icon className="size-5" />
						{def.name}
					</DialogTitle>
					<DialogDescription>
						{def.description} {def.setup}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="flex items-center justify-between rounded-lg border p-3">
						<div className="space-y-0.5">
							<Label>Enabled</Label>
							<p className="text-xs text-muted-foreground">
								The gateway runs while this and the agent master switch are on.
							</p>
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
						<p className="text-xs text-muted-foreground">
							{def.identifierHint}
						</p>
					</div>

					{hasSecrets && (
						<p className="text-xs text-muted-foreground">
							Leave secret fields blank to keep the saved values.
						</p>
					)}

					{testResult && (
						<AlertBlock type="success">
							{testResult.url ? (
								<a
									href={testResult.url}
									target="_blank"
									rel="noreferrer"
									className="text-primary inline-flex items-center gap-1"
								>
									{testResult.label} <ExternalLink className="size-3.5" />
								</a>
							) : (
								testResult.label
							)}
						</AlertBlock>
					)}
				</div>

				<DialogFooter className="gap-2 sm:justify-between">
					<div className="flex items-center gap-2">
						{channel && (
							<DialogAction
								title={`Disconnect ${def.name}`}
								description="This removes the stored credentials for this channel."
								type="destructive"
								onClick={handleDelete}
							>
								<Button size="sm" variant="ghost">
									<Trash2 className="size-4" />
									Disconnect
								</Button>
							</DialogAction>
						)}
					</div>
					<div className="flex items-center gap-2">
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
						<Button size="sm" onClick={handleSave} disabled={isSaving}>
							{isSaving && <Loader2 className="size-4 animate-spin" />}
							Save
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

const AddGatewayDialog = ({
	open,
	onOpenChange,
	available,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	available: ChannelDef[];
	onPick: (type: ChannelType) => void;
}) => (
	<Dialog open={open} onOpenChange={onOpenChange}>
		<DialogContent className="sm:max-w-lg">
			<DialogHeader>
				<DialogTitle>Add a chat gateway</DialogTitle>
				<DialogDescription>
					Pick where you want to talk to the agent. You only configure the
					gateways you actually use.
				</DialogDescription>
			</DialogHeader>
			<div className="grid sm:grid-cols-2 gap-2">
				{available.map((def) => {
					const Icon = def.icon;
					return (
						<button
							key={def.type}
							type="button"
							className="rounded-lg border p-3 text-left hover:bg-accent transition-colors flex flex-col gap-1"
							onClick={() => onPick(def.type)}
						>
							<span className="flex items-center gap-2 font-medium">
								<Icon className="size-4" />
								{def.name}
							</span>
							<span className="text-xs text-muted-foreground">
								{def.description}
							</span>
						</button>
					);
				})}
			</div>
		</DialogContent>
	</Dialog>
);

export const AgentChannels = () => {
	const utils = api.useUtils();
	const { data: agent } = api.agent.get.useQuery();
	// Poll so runtime errors (e.g. a token rejected after save) surface on their own.
	const { data: channels } = api.agent.channels.useQuery(undefined, {
		refetchInterval: 15_000,
	});
	const { mutateAsync: saveAgent, isPending: isEnablingAgent } =
		api.agent.save.useMutation();

	const [addOpen, setAddOpen] = useState(false);
	const [configuring, setConfiguring] = useState<ChannelType | null>(null);

	const configured = CHANNELS.filter((def) =>
		channels?.some((channel) => channel.type === def.type),
	);
	const available = CHANNELS.filter(
		(def) => !channels?.some((channel) => channel.type === def.type),
	);
	const configuringDef = CHANNELS.find((def) => def.type === configuring);

	const handleEnableAgent = async () => {
		if (!agent) return;
		try {
			await saveAgent({
				name: agent.name,
				isEnabled: true,
				instructions: agent.instructions,
				aiId: agent.aiId,
				model: agent.model,
			});
			await utils.agent.get.invalidate();
			await utils.agent.channels.invalidate();
			toast.success("Agent enabled — gateways are starting");
		} catch (error) {
			toast.error("Failed to enable the agent", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	return (
		<Card className="rounded-lg w-full bg-sidebar p-2.5">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
					<div className="space-y-1.5">
						<CardTitle className="text-xl flex items-center gap-2">
							<MessageCircle className="size-5" />
							Chat gateways
						</CardTitle>
						<CardDescription>
							Connect the agent to the chat apps you already use. Each gateway
							has its own allowlist, and nobody can talk to the agent until you
							add them.
						</CardDescription>
					</div>
					{agent && available.length > 0 && (
						<Button size="sm" onClick={() => setAddOpen(true)}>
							<Plus className="size-4" />
							Add gateway
						</Button>
					)}
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{!agent && (
						<AlertBlock type="info">
							Save the agent settings above once before connecting a gateway.
						</AlertBlock>
					)}
					{agent && !agent.isEnabled && (
						<AlertBlock type="warning">
							<span className="flex items-center gap-3 flex-wrap">
								The agent is disabled, so no gateway is running.
								<Button
									size="sm"
									variant="outline"
									onClick={handleEnableAgent}
									disabled={isEnablingAgent}
								>
									{isEnablingAgent && (
										<Loader2 className="size-4 animate-spin" />
									)}
									Enable agent
								</Button>
							</span>
						</AlertBlock>
					)}
					{agent && configured.length === 0 && (
						<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
							<MessageCircle className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								No gateway connected yet. Add the chat app you want to talk to
								the agent from.
							</p>
							<Button size="sm" onClick={() => setAddOpen(true)}>
								<Plus className="size-4" />
								Add gateway
							</Button>
						</div>
					)}
					{agent &&
						configured.map((def) => {
							const channel = channels?.find((item) => item.type === def.type);
							if (!channel) return null;
							return (
								<ChannelRow
									key={def.type}
									def={def}
									channel={channel}
									agentEnabled={agent.isEnabled}
									onConfigure={() => setConfiguring(def.type)}
								/>
							);
						})}
				</CardContent>
			</div>

			<AddGatewayDialog
				open={addOpen}
				onOpenChange={setAddOpen}
				available={available}
				onPick={(type) => {
					setAddOpen(false);
					setConfiguring(type);
				}}
			/>

			{configuringDef && (
				<ChannelConfigDialog
					def={configuringDef}
					channel={channels?.find((item) => item.type === configuringDef.type)}
					onClose={() => setConfiguring(null)}
				/>
			)}
		</Card>
	);
};
