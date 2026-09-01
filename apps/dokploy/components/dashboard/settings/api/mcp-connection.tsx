import copy from "copy-to-clipboard";
import {
	BotIcon,
	CheckIcon,
	CopyIcon,
	KeyIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import {
	buildMcpApiKeyInput,
	forgetMcpApiKey,
	loadMcpApiKey,
	rememberMcpApiKey,
} from "@/lib/mcp-api-key";
import { api } from "@/utils/api";
import { useUrl } from "@/utils/hooks/use-url";

const API_KEY_PLACEHOLDER = "YOUR_API_KEY";

interface Snippet {
	label: string;
	language: "json" | "toml" | "bash" | "text";
	build: (mcpUrl: string, apiKey: string) => string;
}

interface Provider {
	id: string;
	name: string;
	hint: string;
	snippets: Snippet[];
}

const remoteBridgeArgs = (mcpUrl: string, apiKey: string) =>
	`["-y", "mcp-remote", "${mcpUrl}", "--header", "x-api-key: ${apiKey}"]`;

const mcpServersJson = (mcpUrl: string, apiKey: string) => `{
  "mcpServers": {
    "dokploy": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`;

const PROVIDERS: Provider[] = [
	{
		id: "claude-code",
		name: "Claude Code",
		hint: "Run this once in your terminal — it registers Dokploy for every Claude Code session.",
		snippets: [
			{
				label: "Terminal command",
				language: "bash",
				build: (mcpUrl, apiKey) =>
					`claude mcp add --transport http dokploy ${mcpUrl} --header "x-api-key: ${apiKey}"`,
			},
		],
	},
	{
		id: "claude-desktop",
		name: "Claude Desktop",
		hint: "Add to claude_desktop_config.json (Settings → Developer → Edit Config). Uses the mcp-remote bridge since Claude Desktop config connects over stdio.",
		snippets: [
			{
				label: "claude_desktop_config.json",
				language: "json",
				build: (mcpUrl, apiKey) => `{
  "mcpServers": {
    "dokploy": {
      "command": "npx",
      "args": ${remoteBridgeArgs(mcpUrl, apiKey)}
    }
  }
}`,
			},
		],
	},
	{
		id: "cursor",
		name: "Cursor",
		hint: "Add to .cursor/mcp.json in your project, or ~/.cursor/mcp.json to enable it globally.",
		snippets: [
			{
				label: "mcp.json",
				language: "json",
				build: (mcpUrl, apiKey) => `{
  "mcpServers": {
    "dokploy": {
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`,
			},
		],
	},
	{
		id: "vscode",
		name: "VS Code (Copilot)",
		hint: "Add to .vscode/mcp.json in your workspace, then start the server from the MCP panel.",
		snippets: [
			{
				label: ".vscode/mcp.json",
				language: "json",
				build: (mcpUrl, apiKey) => `{
  "servers": {
    "dokploy": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`,
			},
		],
	},
	{
		id: "windsurf",
		name: "Windsurf",
		hint: "Add to ~/.codeium/windsurf/mcp_config.json, then refresh plugins in Cascade.",
		snippets: [
			{
				label: "mcp_config.json",
				language: "json",
				build: (mcpUrl, apiKey) => `{
  "mcpServers": {
    "dokploy": {
      "serverUrl": "${mcpUrl}",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`,
			},
		],
	},
	{
		id: "cline",
		name: "Cline",
		hint: "Open Cline → MCP Servers → Configure, and add this to cline_mcp_settings.json.",
		snippets: [
			{
				label: "cline_mcp_settings.json",
				language: "json",
				build: (mcpUrl, apiKey) => `{
  "mcpServers": {
    "dokploy": {
      "type": "streamableHttp",
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`,
			},
		],
	},
	{
		id: "roo-code",
		name: "Roo Code",
		hint: "Open Roo Code → MCP Servers → Edit Global MCP, and add this entry.",
		snippets: [
			{
				label: "mcp_settings.json",
				language: "json",
				build: (mcpUrl, apiKey) => `{
  "mcpServers": {
    "dokploy": {
      "type": "streamable-http",
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`,
			},
		],
	},
	{
		id: "codex",
		name: "Codex CLI",
		hint: "Add to ~/.codex/config.toml. Uses the mcp-remote bridge for the authenticated HTTP connection.",
		snippets: [
			{
				label: "config.toml",
				language: "toml",
				build: (mcpUrl, apiKey) => `[mcp_servers.dokploy]
command = "npx"
args = ${remoteBridgeArgs(mcpUrl, apiKey)}`,
			},
		],
	},
	{
		id: "gemini",
		name: "Gemini CLI",
		hint: "Add to ~/.gemini/settings.json (or .gemini/settings.json in your project).",
		snippets: [
			{
				label: "settings.json",
				language: "json",
				build: (mcpUrl, apiKey) => `{
  "mcpServers": {
    "dokploy": {
      "httpUrl": "${mcpUrl}",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`,
			},
		],
	},
	{
		id: "opencode",
		name: "OpenCode",
		hint: "Add to opencode.json in your project or ~/.config/opencode/opencode.json.",
		snippets: [
			{
				label: "opencode.json",
				language: "json",
				build: (mcpUrl, apiKey) => `{
  "mcp": {
    "dokploy": {
      "type": "remote",
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "${apiKey}"
      }
    }
  }
}`,
			},
		],
	},
	{
		id: "zed",
		name: "Zed",
		hint: "Add to Zed's settings.json (Cmd/Ctrl+Shift+P → “zed: open settings”). Uses the mcp-remote bridge.",
		snippets: [
			{
				label: "settings.json",
				language: "json",
				build: (mcpUrl, apiKey) => `{
  "context_servers": {
    "dokploy": {
      "source": "custom",
      "command": "npx",
      "args": ${remoteBridgeArgs(mcpUrl, apiKey)}
    }
  }
}`,
			},
		],
	},
	{
		id: "generic",
		name: "Other (JSON)",
		hint: "Standard MCP JSON for any client that supports the Streamable HTTP transport.",
		snippets: [
			{
				label: "JSON config",
				language: "json",
				build: mcpServersJson,
			},
		],
	},
];

const CopyableBlock = ({ label, value }: { label: string; value: string }) => {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-sm font-medium text-muted-foreground">{label}</span>
			<div className="relative">
				<pre className="rounded-lg border bg-muted/40 p-3 pr-12 text-xs overflow-x-auto whitespace-pre">
					{value}
				</pre>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="absolute right-1.5 top-1.5 h-7 w-7"
					onClick={() => {
						copy(value);
						setCopied(true);
						setTimeout(() => setCopied(false), 2000);
						toast.success("Copied to clipboard");
					}}
				>
					{copied ? (
						<CheckIcon className="size-3.5 text-green-500" />
					) : (
						<CopyIcon className="size-3.5" />
					)}
				</Button>
			</div>
		</div>
	);
};

export const McpConnection = () => {
	const url = useUrl();
	const mcpUrl = `${url}/api/mcp`;
	const [selectedProvider, setSelectedProvider] = useState(PROVIDERS[0]?.id);
	const [apiKey, setApiKey] = useState("");

	const { data: activeOrganization } = api.organization.active.useQuery();
	const { refetch: refetchUser } = api.user.get.useQuery();
	const createApiKey = api.user.createApiKey.useMutation({
		onSuccess: (data) => {
			if (!data) return;
			setApiKey(data.key);
			if (activeOrganization?.id) {
				rememberMcpApiKey(
					window.sessionStorage,
					activeOrganization.id,
					data.key,
				);
			}
			void refetchUser();
			toast.success(
				"API key generated and retained for this browser tab. Copy your agent config before you forget the key or close the browser session.",
			);
		},
		onError: () => {
			toast.error("Failed to generate API key");
		},
	});

	useEffect(() => {
		if (!activeOrganization?.id) return;
		setApiKey(loadMcpApiKey(window.sessionStorage, activeOrganization.id));
	}, [activeOrganization?.id]);

	const provider =
		PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];

	const effectiveKey = apiKey.trim() || API_KEY_PLACEHOLDER;
	const isPlaceholder = effectiveKey === API_KEY_PLACEHOLDER;

	const generateKey = () => {
		if (!activeOrganization?.id) {
			toast.error("No active organization found");
			return;
		}
		createApiKey.mutate(buildMcpApiKeyInput(activeOrganization.id));
	};

	const updateApiKey = (value: string) => {
		setApiKey(value);
		if (activeOrganization?.id) {
			rememberMcpApiKey(window.sessionStorage, activeOrganization.id, value);
		}
	};

	const forgetKey = () => {
		setApiKey("");
		if (activeOrganization?.id) {
			forgetMcpApiKey(window.sessionStorage, activeOrganization.id);
		}
		toast.success("API key forgotten from this browser tab");
	};

	return (
		<div className="w-full">
			<Card className="h-full bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
				<div className="rounded-xl bg-background shadow-md">
					<CardHeader>
						<CardTitle className="text-xl flex items-center gap-2">
							<BotIcon className="size-5" />
							MCP Server
						</CardTitle>
						<CardDescription>
							Let AI agents manage this Dokploy instance: create projects,
							applications and databases, configure environment variables,
							deploy to remote servers and more — without opening the dashboard.
							Pick your agent below and copy a ready-to-use config.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-5 border-t pt-6">
						<CopyableBlock label="Endpoint (Streamable HTTP)" value={mcpUrl} />

						<div className="flex flex-col gap-1.5">
							<span className="text-sm font-medium text-muted-foreground">
								API Key
							</span>
							<div className="flex flex-col sm:flex-row gap-2">
								<Input
									type="password"
									placeholder="Paste an existing API key, or generate one"
									value={apiKey}
									onChange={(e) => updateApiKey(e.target.value)}
									className="font-mono text-xs"
									autoComplete="off"
									enablePasswordGenerator={false}
									enableCopyButton={!!apiKey}
								/>
								<Button
									type="button"
									variant="secondary"
									className="shrink-0"
									isLoading={createApiKey.isPending}
									onClick={generateKey}
								>
									{!createApiKey.isPending && (
										<KeyIcon className="size-4 mr-1" />
									)}
									Generate Key
								</Button>
								{apiKey && (
									<Button
										type="button"
										variant="outline"
										className="shrink-0"
										onClick={forgetKey}
									>
										<Trash2Icon className="size-4 mr-1" />
										Forget
									</Button>
								)}
							</div>
							<span className="text-xs text-muted-foreground">
								{isPlaceholder ? (
									<>
										The configs below use the{" "}
										<code className="font-mono">YOUR_API_KEY</code> placeholder
										until you paste or generate a key. Generated keys belong to
										your user in the{" "}
										<span className="font-medium">
											{activeOrganization?.name ?? "active"}
										</span>{" "}
										organization and never expire — you can revoke them anytime
										in the API/CLI Keys section above.
									</>
								) : (
									"Your key is filled into every config below and retained only in this browser tab's session, so it survives a refresh. Dokploy stores only its verification hash; use Forget or close the browser session to remove this temporary browser copy."
								)}
							</span>
						</div>

						<div className="flex flex-col gap-2">
							<span className="text-sm font-medium text-muted-foreground">
								Choose your agent
							</span>
							<div className="flex flex-wrap gap-2">
								{PROVIDERS.map((p) => (
									<Button
										key={p.id}
										type="button"
										size="sm"
										variant={p.id === provider?.id ? "default" : "outline"}
										onClick={() => setSelectedProvider(p.id)}
									>
										{p.name}
									</Button>
								))}
							</div>
						</div>

						{provider && (
							<div className="flex flex-col gap-3 rounded-lg border p-4">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium">{provider.name}</span>
									{!isPlaceholder && (
										<Badge variant="green" className="text-[10px]">
											Ready to use
										</Badge>
									)}
								</div>
								<span className="text-sm text-muted-foreground">
									{provider.hint}
								</span>
								{provider.snippets.map((snippet) => (
									<CopyableBlock
										key={snippet.label}
										label={snippet.label}
										value={snippet.build(mcpUrl, effectiveKey)}
									/>
								))}
							</div>
						)}

						<span className="text-sm text-muted-foreground">
							The agent gets the same access as the key's user, covering the
							entire Dokploy API.
						</span>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
