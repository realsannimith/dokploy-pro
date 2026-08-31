import { describe, expect, it } from "vitest";
import { getMcpTools, MCP_SERVER_INSTRUCTIONS } from "@/server/mcp/registry";

describe("Dokploy MCP registry", () => {
	it("catalogs all request-response procedures without OpenAPI conversion", () => {
		const tools = getMcpTools();

		expect(tools.size).toBeGreaterThan(600);
		expect(tools.get("application-create")?.type).toBe("mutation");
		expect(tools.get("application-one")?.type).toBe("query");
		expect(tools.get("agent-saveToolConfig")?.inputSchema.type).toBe("object");
		expect(tools.has("subscription-transfer-transferWithLogs")).toBe(false);
	});

	it("advertises the asynchronous deploy, follow, and log workflow", () => {
		const tools = getMcpTools();

		expect(tools.get("deployment-followLatest")?.type).toBe("query");
		expect(
			tools.get("deployment-follow")?.inputSchema.properties,
		).toHaveProperty("deploymentId");
		expect(tools.get("deployment-readLogs")?.description).toContain(
			"actual build server",
		);
		expect(tools.get("application-deploy")?.description).toContain(
			"only confirms queueing",
		);
		expect(MCP_SERVER_INSTRUCTIONS).toContain("autoDeploy=true");
		expect(MCP_SERVER_INSTRUCTIONS).toContain("deployment-followLatest");
	});
});
