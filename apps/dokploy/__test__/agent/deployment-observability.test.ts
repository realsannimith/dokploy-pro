import { describe, expect, it, vi } from "vitest";
import { buildAgentTools } from "@/server/agent/tools";

describe("agent deployment observability", () => {
	it("shows and configures push auto-deployment", async () => {
		const application = {
			applicationId: "application-1",
			name: "API",
			appName: "api-prod",
			sourceType: "github",
			repository: "api",
			branch: "main",
			autoDeploy: true,
			triggerType: "push",
		};
		const caller = {
			application: {
				one: vi.fn().mockResolvedValue(application),
				update: vi.fn().mockResolvedValue(true),
			},
		};
		const tools = buildAgentTools(caller as never, { agentId: "agent-1" });

		const details = JSON.parse(
			await (tools.getService as any).execute({
				serviceType: "application",
				serviceId: "application-1",
			}),
		);
		expect(details).toMatchObject({
			autoDeploy: true,
			triggerType: "push",
			branch: "main",
			pushDeployReady: true,
		});

		const configured = JSON.parse(
			await (tools.configureAutoDeploy as any).execute({
				serviceType: "application",
				serviceId: "application-1",
				enabled: true,
				triggerType: "push",
			}),
		);
		expect(caller.application.update).toHaveBeenCalledWith({
			applicationId: "application-1",
			autoDeploy: true,
			triggerType: "push",
		});
		expect(configured).toMatchObject({
			pushDeployReady: true,
			branch: "main",
		});
	});

	it("correlates a queued deployment with the previous deployment id", async () => {
		const caller = {
			application: {
				deploy: vi.fn().mockResolvedValue(undefined),
			},
			deployment: {
				latest: vi.fn().mockResolvedValue({
					found: true,
					deploymentId: "deployment-old",
				}),
				followLatest: vi.fn().mockResolvedValue({
					found: true,
					deploymentId: "deployment-new",
					status: "running",
					state: "in-progress",
					terminal: false,
					success: false,
					timedOut: true,
				}),
			},
		};
		const tools = buildAgentTools(caller as never, { agentId: "agent-1" });

		const result = JSON.parse(
			await (tools.deployService as any).execute({
				serviceType: "application",
				serviceId: "application-1",
			}),
		);

		expect(caller.application.deploy).toHaveBeenCalled();
		expect(caller.deployment.followLatest).toHaveBeenCalledWith({
			type: "application",
			id: "application-1",
			afterDeploymentId: "deployment-old",
			timeoutSeconds: 5,
			pollIntervalSeconds: 1,
			tail: 50,
		});
		expect(result.observation).toMatchObject({
			deploymentId: "deployment-new",
			state: "in-progress",
			timedOut: true,
		});
	});

	it("follows a known deployment and reads current application logs", async () => {
		const caller = {
			deployment: {
				follow: vi.fn().mockResolvedValue({
					found: true,
					deploymentId: "deployment-1",
					state: "failed",
					terminal: true,
					success: false,
					logs: "build failed",
				}),
			},
			application: {
				readLogs: vi.fn().mockResolvedValue("server listening"),
			},
		};
		const tools = buildAgentTools(caller as never, { agentId: "agent-1" });

		const observation = JSON.parse(
			await (tools.followDeployment as any).execute({
				type: "application",
				id: "application-1",
				deploymentId: "deployment-1",
				waitSeconds: 20,
				tail: 100,
			}),
		);
		expect(observation).toMatchObject({
			state: "failed",
			terminal: true,
			logs: "build failed",
		});

		const logs = await (tools.readRuntimeLogs as any).execute({
			serviceType: "application",
			serviceId: "application-1",
			tail: 100,
			since: "10m",
		});
		expect(logs).toBe("server listening");
		expect(caller.application.readLogs).toHaveBeenCalledWith({
			applicationId: "application-1",
			tail: 100,
			since: "10m",
			search: undefined,
		});
	});
});
