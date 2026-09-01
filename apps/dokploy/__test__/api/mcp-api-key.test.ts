import { describe, expect, it } from "vitest";
import {
	buildMcpApiKeyInput,
	forgetMcpApiKey,
	loadMcpApiKey,
	rememberMcpApiKey,
} from "../../lib/mcp-api-key";

describe("MCP API key generation", () => {
	it("disables the API-key rate limit used by Better Auth by default", () => {
		expect(
			buildMcpApiKeyInput(
				"organization-1",
				new Date("2026-09-01T00:00:00.000Z"),
			),
		).toEqual({
			name: "mcp-agent-2026-09-01",
			metadata: { organizationId: "organization-1" },
			rateLimitEnabled: false,
		});
	});

	it("retains and forgets the plaintext key for the browser-tab session", () => {
		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		};

		rememberMcpApiKey(storage, "organization-1", "secret-key");
		expect(loadMcpApiKey(storage, "organization-1")).toBe("secret-key");
		expect(loadMcpApiKey(storage, "organization-2")).toBe("");

		forgetMcpApiKey(storage, "organization-1");
		expect(loadMcpApiKey(storage, "organization-1")).toBe("");
	});
});
