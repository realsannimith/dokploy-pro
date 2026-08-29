import { describe, expect, it } from "vitest";
import { getMcpTools } from "@/server/mcp/registry";

describe("Dokploy MCP registry", () => {
	it("catalogs all request-response procedures without OpenAPI conversion", () => {
		const tools = getMcpTools();

		expect(tools.size).toBeGreaterThan(600);
		expect(tools.get("application-create")?.type).toBe("mutation");
		expect(tools.get("application-one")?.type).toBe("query");
		expect(tools.get("agent-saveToolConfig")?.inputSchema.type).toBe("object");
		expect(tools.has("subscription-transfer-transferWithLogs")).toBe(false);
	});
});
