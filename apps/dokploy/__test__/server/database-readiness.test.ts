import {
	inspectDatabaseServiceRuntime,
	waitForDatabaseServiceRunning,
} from "@dokploy/server";
import { describe, expect, it, vi } from "vitest";

describe("database service readiness", () => {
	it("waits until Docker exposes a running Swarm container", async () => {
		const container = { Id: "container-1" };
		const docker = {
			listContainers: vi
				.fn()
				.mockResolvedValueOnce([])
				.mockResolvedValue([container]),
			listTasks: vi
				.fn()
				.mockResolvedValue([
					{ Version: { Index: 1 }, Status: { State: "preparing" } },
				]),
		};

		await expect(
			waitForDatabaseServiceRunning("postgres-example", null, {
				docker: docker as never,
				sleep: async () => {},
				timeoutMs: 1_000,
			}),
		).resolves.toBe(container);
		expect(docker.listContainers).toHaveBeenCalledTimes(4);
	});

	it("does not accept a transient running container", async () => {
		const container = { Id: "container-1" };
		const docker = {
			listContainers: vi
				.fn()
				.mockResolvedValueOnce([container])
				.mockResolvedValueOnce([])
				.mockResolvedValue([container]),
			listTasks: vi
				.fn()
				.mockResolvedValue([
					{ Version: { Index: 1 }, Status: { State: "preparing" } },
				]),
		};

		await expect(
			waitForDatabaseServiceRunning("postgres-example", null, {
				docker: docker as never,
				requiredConsecutiveRunningChecks: 2,
				sleep: async () => {},
				timeoutMs: 1_000,
			}),
		).resolves.toBe(container);
		expect(docker.listContainers).toHaveBeenCalledTimes(4);
	});

	it("reports a prepared Swarm task as starting, not running", async () => {
		const docker = {
			listContainers: vi.fn().mockResolvedValue([]),
			listTasks: vi.fn().mockResolvedValue([
				{
					Version: { Index: 3 },
					Status: { State: "ready", Message: "prepared" },
				},
			]),
		};

		await expect(
			inspectDatabaseServiceRuntime("postgres-example", null, {
				docker: docker as never,
			}),
		).resolves.toMatchObject({
			state: "starting",
			ready: false,
			taskState: "ready",
			message: "ready: prepared",
		});
	});

	it("reports the latest Swarm task error instead of claiming success", async () => {
		const docker = {
			listContainers: vi.fn().mockResolvedValue([]),
			listTasks: vi.fn().mockResolvedValue([
				{
					Version: { Index: 2 },
					Status: { State: "rejected", Err: "no suitable node" },
				},
			]),
		};

		await expect(
			waitForDatabaseServiceRunning("postgres-example", null, {
				docker: docker as never,
				timeoutMs: 0,
			}),
		).rejects.toThrow(
			"Runtime status: failed. Last Swarm task: rejected: no suitable node",
		);
	});
});
