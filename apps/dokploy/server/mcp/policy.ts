import type { AgentMcpConfig } from "@dokploy/server/db/schema/agent";
import type { McpToolDef } from "./registry";

export interface ResolvedMcpPolicy {
	enabled: boolean;
	mode: "full" | "read-only" | "custom";
	disabledRouters: string[];
}

/** No agent row / empty config means full access, matching prior behavior. */
export const resolveMcpPolicy = (
	config?: AgentMcpConfig | null,
): ResolvedMcpPolicy => ({
	enabled: config?.enabled ?? true,
	mode: config?.mode ?? "full",
	disabledRouters: config?.disabledRouters ?? [],
});

export const routerOfTool = (tool: McpToolDef) =>
	tool.procedurePath.split(".")[0] ?? "";

export const isMcpToolAllowed = (
	tool: McpToolDef,
	policy: ResolvedMcpPolicy,
) => {
	if (!policy.enabled) return false;
	if (policy.mode === "read-only") return tool.type === "query";
	if (policy.mode === "custom") {
		return !policy.disabledRouters.includes(routerOfTool(tool));
	}
	return true;
};
