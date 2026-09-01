import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	validateRequest: vi.fn(),
	findAgentByOrganizationId: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	validateRequest: mocks.validateRequest,
}));

vi.mock("@dokploy/server/services/agent", () => ({
	findAgentByOrganizationId: mocks.findAgentByOrganizationId,
}));

vi.mock("@/server/api/root", () => ({
	appRouter: {
		createCaller: () => ({}),
	},
}));

vi.mock("@/server/api/trpc", () => ({
	createTRPCContext: vi.fn(),
}));

vi.mock("@/server/mcp/registry", () => ({
	MCP_SERVER_INSTRUCTIONS: "Test MCP instructions",
	getMcpTools: () =>
		new Map([
			[
				"project-all",
				{
					name: "project-all",
					description: "List projects",
					inputSchema: { type: "object", properties: {} },
					procedurePath: "project.all",
					type: "query",
				},
			],
		]),
}));

const { default: mcpHandler } = await import("@/pages/api/mcp");

describe("MCP HTTP endpoint", () => {
	let server: Server;
	let endpoint: string;

	beforeEach(async () => {
		mocks.validateRequest.mockResolvedValue({
			user: { id: "user-1" },
			session: {
				userId: "user-1",
				activeOrganizationId: "organization-1",
			},
		});
		mocks.findAgentByOrganizationId.mockResolvedValue({
			mcpConfig: { enabled: true, mode: "full", disabledRouters: [] },
		});

		server = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				chunks.push(Buffer.from(chunk));
			}
			const body = Buffer.concat(chunks).toString("utf8");
			(request as typeof request & { body?: unknown }).body = body
				? JSON.parse(body)
				: undefined;
			await mcpHandler(request as never, response as never);
		});

		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Test server did not bind to a TCP port");
		}
		endpoint = `http://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	const request = (body: Record<string, unknown>) =>
		fetch(endpoint, {
			method: "POST",
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
				"x-api-key": "valid-test-key",
			},
			body: JSON.stringify(body),
		});

	it("completes initialization and returns the available tools", async () => {
		const initializeResponse = await request({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-03-26",
				capabilities: {},
				clientInfo: { name: "connection-test", version: "1.0.0" },
			},
		});
		expect(initializeResponse.status).toBe(200);
		const initialize = await initializeResponse.json();
		expect(initialize).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: { serverInfo: { name: "dokploy" } },
		});

		const toolsResponse = await request({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
			params: {},
		});
		expect(toolsResponse.status).toBe(200);
		const tools = await toolsResponse.json();
		expect(tools).toMatchObject({
			jsonrpc: "2.0",
			id: 2,
			result: { tools: [{ name: "project-all" }] },
		});
	});
});
