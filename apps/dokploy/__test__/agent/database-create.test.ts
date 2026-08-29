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
				one: vi.fn().mockResolvedValue({
					deploymentStatus: "done",
					runtime: {
						state: "running",
						ready: true,
						taskState: "running",
						message: "running",
					},
				}),
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
			runtime: { state: "running", ready: true },
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

	it("returns live runtime state instead of treating stored done as running", async () => {
		const caller = {
			postgres: {
				one: vi.fn().mockResolvedValue({
					postgresId: "postgres-1",
					name: "Example DB",
					appName: "postgres-example",
					applicationStatus: "running",
					deploymentStatus: "done",
					runtime: {
						state: "starting",
						ready: false,
						taskState: "ready",
						message: "ready: prepared",
					},
				}),
			},
		};
		const tools = buildAgentTools(caller as never, { agentId: "agent-1" });

		const result = await (tools.getService as any).execute({
			serviceType: "postgres",
			serviceId: "postgres-1",
		});
		const parsed = JSON.parse(result);

		expect(parsed.deploymentStatus).toBe("done");
		expect(parsed.applicationStatus).toBe("running");
		expect(parsed.runtime).toMatchObject({
			state: "starting",
			ready: false,
			message: "ready: prepared",
		});
	});

	it("does not claim a redeployed database is ready when live state disagrees", async () => {
		const caller = {
			postgres: {
				deploy: vi.fn().mockResolvedValue({}),
				one: vi.fn().mockResolvedValue({
					applicationStatus: "running",
					deploymentStatus: "done",
					runtime: {
						state: "starting",
						ready: false,
						taskState: "ready",
						message: "ready: prepared",
					},
				}),
			},
		};
		const tools = buildAgentTools(caller as never, { agentId: "agent-1" });

		const result = await (tools.deployService as any).execute({
			serviceType: "postgres",
			serviceId: "postgres-1",
		});
		const parsed = JSON.parse(result);

		expect(parsed.message).toContain("not currently ready");
		expect(parsed.runtime.ready).toBe(false);
	});
});
