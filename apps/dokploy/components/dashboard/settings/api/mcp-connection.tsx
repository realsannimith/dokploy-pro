import copy from "copy-to-clipboard";
import { BotIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useUrl } from "@/utils/hooks/use-url";

const CopyableBlock = ({ label, value }: { label: string; value: string }) => {
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
						toast.success("Copied to clipboard");
					}}
				>
					<CopyIcon className="size-3.5" />
				</Button>
			</div>
		</div>
	);
};

export const McpConnection = () => {
	const url = useUrl();
	const mcpUrl = `${url}/api/mcp`;

	const jsonConfig = `{
  "mcpServers": {
    "dokploy": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}`;

	const claudeCommand = `claude mcp add --transport http dokploy ${mcpUrl} --header "x-api-key: YOUR_API_KEY"`;

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
							Let AI agents (Claude Code, Cursor, etc.) manage this Dokploy
							instance: create projects, applications and databases, configure
							environment variables, deploy to remote servers and more — without
							opening the dashboard.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-4 border-t pt-6">
						<CopyableBlock label="Endpoint (Streamable HTTP)" value={mcpUrl} />
						<CopyableBlock label="Claude Code" value={claudeCommand} />
						<CopyableBlock
							label="JSON config (Cursor, Claude Desktop, etc.)"
							value={jsonConfig}
						/>
						<span className="text-sm text-muted-foreground">
							Replace <code className="font-mono">YOUR_API_KEY</code> with an
							API key generated in the API/CLI Keys section above. The agent
							gets the same access as the key's user, covering the entire
							Dokploy API.
						</span>
					</CardContent>
				</div>
			</Card>
		</div>
	);
};
