import { describe, expect, it } from "vitest";
import {
	isDeploymentTerminal,
	pollDeployment,
	resolveDeploymentLogServerId,
	summarizeDeploymentObservation,
} from "@/server/deployment-observability";

const deployment = (status: "running" | "done" | "error" | "cancelled") => ({
	deploymentId: "deployment-1",
	status,
	title: "Deploy API",
	description: "Hash: abc123",
	errorMessage: status === "error" ? "build failed" : null,
	createdAt: "2026-09-01T00:00:00.000Z",
	startedAt: "2026-09-01T00:00:01.000Z",
	finishedAt: status === "running" ? null : "2026-09-01T00:00:03.000Z",
	applicationId: "application-1",
	composeId: null,
	serverId: "runtime-server",
	buildServerId: "build-server",
	application: {
		applicationId: "application-1",
		name: "API",
		appName: "api-prod",
		serverId: "runtime-server",
	},
	compose: null,
	schedule: null,
});

describe("deployment observations", () => {
	it("normalizes terminal success and failure without treating running as done", () => {
		expect(isDeploymentTerminal("running")).toBe(false);
		expect(isDeploymentTerminal("done")).toBe(true);
		expect(isDeploymentTerminal("error")).toBe(true);

		expect(
			summarizeDeploymentObservation(deployment("done"), {
				logs: "Deployment completed",
			}),
		).toMatchObject({
			status: "done",
			state: "succeeded",
			terminal: true,
			success: true,
			timedOut: false,
			service: { type: "application", id: "application-1", name: "API" },
			logs: "Deployment completed",
		});

		expect(
			summarizeDeploymentObservation(deployment("running"), {
				timedOut: true,
			}),
		).toMatchObject({
			state: "in-progress",
			terminal: false,
			success: false,
			timedOut: true,
		});
	});

	it("reads build logs from a dedicated build server before the runtime server", () => {
		expect(resolveDeploymentLogServerId(deployment("running"))).toBe(
			"build-server",
		);
		expect(
			resolveDeploymentLogServerId({
				...deployment("running"),
				buildServerId: null,
			}),
		).toBe("runtime-server");
	});

	it("polls until a terminal record is available", async () => {
		let now = 0;
		const records = [
			deployment("running"),
			deployment("running"),
			deployment("done"),
		];
		const result = await pollDeployment({
			load: async () => records.shift() ?? deployment("done"),
			isComplete: (record) => isDeploymentTerminal(record.status),
			timeoutMs: 10_000,
			pollIntervalMs: 2_000,
			now: () => now,
			sleep: async (milliseconds) => {
				now += milliseconds;
			},
		});

		expect(result.timedOut).toBe(false);
		expect(result.deployment?.status).toBe("done");
		expect(now).toBe(4_000);
	});

	it("returns the latest running state when the observation window expires", async () => {
		let now = 0;
		const result = await pollDeployment({
			load: async () => deployment("running"),
			isComplete: (record) => isDeploymentTerminal(record.status),
			timeoutMs: 3_000,
			pollIntervalMs: 2_000,
			now: () => now,
			sleep: async (milliseconds) => {
				now += milliseconds;
			},
		});

		expect(result.timedOut).toBe(true);
		expect(result.deployment?.status).toBe("running");
		expect(now).toBe(3_000);
	});
});
