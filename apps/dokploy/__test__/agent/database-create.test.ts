import { describe, expect, it, vi } from "vitest";
import { buildAgentTools } from "@/server/agent/tools";

describe("agent database creation", () => {
	it("creates and deploys PostgreSQL before reporting success", async () => {
		const caller = {
			postgres: {
				create: vi.fn().mockResolvedValue({
					postgresId: "postgres-1",
					appName: "postgres-example-actual",
				}),
				deploy: vi.fn().mockResolvedValue({}),
			},
		};
		const tools = buildAgentTools(caller as never, { agentId: "agent-1" });

		const result = await (tools.createDatabase as any).execute({
			databaseType: "postgres",
			environmentId: "environment-1",
			name: "Example DB",
			serverId: "server-1",
		});
		const parsed = JSON.parse(result);

		expect(caller.postgres.deploy).toHaveBeenCalledWith({
			postgresId: "postgres-1",
		});
		expect(parsed).toMatchObject({
			serviceId: "postgres-1",
			appName: "postgres-example-actual",
			deployed: true,
			status: "running",
		});
	});

	it("returns generated credentials when deployment fails", async () => {
		const caller = {
			postgres: {
				create: vi.fn().mockResolvedValue({
					postgresId: "postgres-1",
					appName: "postgres-example-actual",
				}),
				deploy: vi.fn().mockRejectedValue(new Error("task rejected")),
			},
		};
		const tools = buildAgentTools(caller as never, { agentId: "agent-1" });

		const result = await (tools.createDatabase as any).execute({
			databaseType: "postgres",
			environmentId: "environment-1",
			name: "Example DB",
		});
		const parsed = JSON.parse(result);

		expect(parsed.deployed).toBe(false);
		expect(parsed.deploymentError).toContain("task rejected");
		expect(parsed.credentials.password).toBeTruthy();
	});
});
