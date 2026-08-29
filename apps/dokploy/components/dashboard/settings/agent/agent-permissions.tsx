"use client";
import { Loader2, Network, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/utils/api";
import { useUrl } from "@/utils/hooks/use-url";

const GROUP_ORDER = ["Read", "Operate", "Create", "Destructive"] as const;

const GROUP_HINTS: Record<(typeof GROUP_ORDER)[number], string> = {
	Read: "Inspect projects, services, logs and servers. Harmless.",
	Operate: "Deploy, start, stop, run backups and schedules.",
	Create: "Create projects, environments, databases and applications.",
	Destructive: "Delete things. These always ask for confirmation.",
};

type ToolSetting = { enabled: boolean; confirm: boolean };

export const AgentTools = () => {
	const utils = api.useUtils();
	const { data: agent } = api.agent.get.useQuery();
	const { data: tools } = api.agent.tools.useQuery();
	const { mutateAsync: saveToolConfig, isPending: isSaving } =
		api.agent.saveToolConfig.useMutation();

	const [settings, setSettings] = useState<Record<string, ToolSetting>>({});

	useEffect(() => {
		if (!tools) return;
		const next: Record<string, ToolSetting> = {};
		for (const tool of tools) {
			next[tool.name] = { enabled: tool.enabled, confirm: tool.confirm };
		}
		setSettings(next);
	}, [tools]);

	const update = (name: string, patch: Partial<ToolSetting>) =>
		setSettings((prev) => ({
			...prev,
			[name]: {
				...(prev[name] ?? { enabled: true, confirm: false }),
				...patch,
			},
		}));

	const handleSave = async () => {
		try {
			await saveToolConfig(settings);
			await utils.agent.tools.invalidate();
			toast.success("Tool permissions saved");
		} catch (error) {
			toast.error("Failed to save tool permissions", {
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
							<SlidersHorizontal className="size-5" />
							Agent tools & permissions
						</CardTitle>
						<CardDescription>
							Control exactly what the agent is allowed to do. "Ask first" sends
							an Approve/Reject prompt before the action runs — as buttons on
							Telegram, or as a question in other chats. Changes apply from the
							next message.
						</CardDescription>
					</div>
					<Button size="sm" onClick={handleSave} disabled={isSaving || !agent}>
						{isSaving && <Loader2 className="size-4 animate-spin" />}
						Save
					</Button>
				</CardHeader>
				<CardContent className="flex flex-col gap-5">
					{!agent && (
						<AlertBlock type="info">
							Save the agent settings above once before configuring tools.
						</AlertBlock>
					)}
					{GROUP_ORDER.map((group) => {
						const groupTools = (tools ?? []).filter(
							(tool) => tool.group === group,
						);
						if (groupTools.length === 0) return null;
						return (
							<div key={group} className="flex flex-col gap-2">
								<div>
									<h3 className="text-sm font-medium">{group}</h3>
									<p className="text-xs text-muted-foreground">
										{GROUP_HINTS[group]}
									</p>
								</div>
								<div className="rounded-lg border divide-y">
									{groupTools.map((tool) => {
										const setting = settings[tool.name] ?? {
											enabled: tool.enabled,
											confirm: tool.confirm,
										};
										return (
											<div
												key={tool.name}
												className="flex items-center gap-4 p-3"
											>
												<div className="flex-1 min-w-0">
													<div className="flex items-center gap-2">
														<code className="text-sm">{tool.name}</code>
														{tool.destructive && (
															<Badge variant="red">destructive</Badge>
														)}
													</div>
													<p className="text-xs text-muted-foreground">
														{tool.description}
													</p>
												</div>
												<div className="flex items-center gap-2 text-xs text-muted-foreground">
													{tool.destructive ? (
														<Badge variant="yellow">Always asks</Badge>
													) : (
														<>
															Ask first
															<Switch
																checked={setting.confirm}
																disabled={!setting.enabled}
																onCheckedChange={(checked) =>
																	update(tool.name, { confirm: checked })
																}
															/>
														</>
													)}
												</div>
												<div className="flex items-center gap-2 text-xs text-muted-foreground">
													Enabled
													<Switch
														checked={setting.enabled}
														onCheckedChange={(checked) =>
															update(tool.name, { enabled: checked })
														}
													/>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						);
					})}
				</CardContent>
			</div>
		</Card>
	);
};

export const AgentMcp = () => {
	const url = useUrl();
	const utils = api.useUtils();
	const { data: agent } = api.agent.get.useQuery();
	const { data: mcpInfo } = api.agent.mcpInfo.useQuery();
	const { mutateAsync: saveMcpConfig, isPending: isSaving } =
		api.agent.saveMcpConfig.useMutation();

	const [enabled, setEnabled] = useState(true);
	const [mode, setMode] = useState<"full" | "read-only" | "custom">("full");
	const [disabledRouters, setDisabledRouters] = useState<string[]>([]);

	useEffect(() => {
		if (!mcpInfo) return;
		setEnabled(mcpInfo.policy.enabled);
		setMode(mcpInfo.policy.mode);
		setDisabledRouters(mcpInfo.policy.disabledRouters);
	}, [mcpInfo]);

	const toggleRouter = (router: string, allowed: boolean) =>
		setDisabledRouters((prev) =>
			allowed
				? prev.filter((item) => item !== router)
				: prev.includes(router)
					? prev
					: [...prev, router],
		);

	const handleSave = async () => {
		try {
			await saveMcpConfig({ enabled, mode, disabledRouters });
			await utils.agent.mcpInfo.invalidate();
			toast.success("MCP access saved");
		} catch (error) {
			toast.error("Failed to save MCP access", {
				description: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

	const totalTools = (mcpInfo?.routers ?? []).reduce(
		(sum, router) => sum + router.total,
		0,
	);

	return (
		<Card className="rounded-lg w-full bg-sidebar p-2.5">
			<div className="rounded-xl bg-background shadow-md">
				<CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
					<div className="space-y-1.5">
						<CardTitle className="text-xl flex items-center gap-2">
							<Network className="size-5" />
							MCP access
						</CardTitle>
						<CardDescription>
							The MCP endpoint exposes the Dokploy API ({totalTools} tools) to
							external AI clients like Claude Code and Cursor. Control what they
							can reach here; API-key authentication still applies.
						</CardDescription>
					</div>
					<Button size="sm" onClick={handleSave} disabled={isSaving || !agent}>
						{isSaving && <Loader2 className="size-4 animate-spin" />}
						Save
					</Button>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{!agent && (
						<AlertBlock type="info">
							Save the agent settings above once before configuring MCP access.
						</AlertBlock>
					)}
					<div className="space-y-1">
						<Label className="text-xs">Endpoint</Label>
						<code className="block rounded bg-muted px-2 py-1.5 text-xs break-all">
							{url}/api/mcp
						</code>
					</div>
					<div className="flex items-center justify-between rounded-lg border p-3">
						<div className="space-y-0.5">
							<Label>Enable MCP endpoint</Label>
							<p className="text-xs text-muted-foreground">
								When off, every MCP request from this organization is refused.
							</p>
						</div>
						<Switch checked={enabled} onCheckedChange={setEnabled} />
					</div>
					{enabled && (
						<div className="space-y-1">
							<Label className="text-xs">Access mode</Label>
							<Select
								value={mode}
								onValueChange={(value) =>
									setMode(value as "full" | "read-only" | "custom")
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="full">Full access — every tool</SelectItem>
									<SelectItem value="read-only">
										Read-only — queries only, no mutations
									</SelectItem>
									<SelectItem value="custom">
										Custom — pick allowed API areas
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
					{enabled && mode === "custom" && (
						<div className="space-y-1">
							<Label className="text-xs">Allowed API areas</Label>
							<ScrollArea className="h-64 rounded-lg border p-3">
								<div className="grid sm:grid-cols-2 gap-2">
									{(mcpInfo?.routers ?? []).map((router) => {
										const allowed = !disabledRouters.includes(router.router);
										return (
											<div
												key={router.router}
												className="flex items-center gap-2 text-sm"
											>
												<Checkbox
													checked={allowed}
													onCheckedChange={(checked) =>
														toggleRouter(router.router, checked === true)
													}
												/>
												<code className="text-xs">{router.router}</code>
												<span className="text-xs text-muted-foreground">
													{router.total} tools
												</span>
											</div>
										);
									})}
								</div>
							</ScrollArea>
						</div>
					)}
				</CardContent>
			</div>
		</Card>
	);
};
