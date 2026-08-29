import {
	getMonitoringImage,
	includeServiceInMetricsConfig,
	prepareMetricsConfigForAgent,
} from "@dokploy/server/setup/monitoring-setup";
import { afterEach, describe, expect, it, vi } from "vitest";

const createConfig = (include: string[], exclude: string[] = []) => ({
	server: {
		type: "Remote" as const,
		refreshRate: 60,
		port: 4500,
		token: "token",
		urlCallback: "https://dokploy.example/callback",
		cronJob: "0 0 * * *",
		retentionDays: 2,
		thresholds: { cpu: 0, memory: 0 },
	},
	containers: {
		refreshRate: 60,
		services: { include, exclude },
	},
});

describe("prepareMetricsConfigForAgent", () => {
	it("encodes an empty include list as monitor all for legacy agents", () => {
		const source = createConfig([]);
		const result = prepareMetricsConfigForAgent(source);

		expect(result.containers.services.include).toEqual([""]);
		expect(source.containers.services.include).toEqual([]);
	});

	it("preserves selected services", () => {
		const result = prepareMetricsConfigForAgent(
			createConfig(["workspace-workspacedb-uihovc"]),
		);

		expect(result.containers.services.include).toEqual([
			"workspace-workspacedb-uihovc",
		]);
	});

	it("encodes explicit include and exclude wildcards for legacy agents", () => {
		const result = prepareMetricsConfigForAgent(createConfig(["*"], ["*"]));

		expect(result.containers.services.include).toEqual([""]);
		expect(result.containers.services.exclude).toEqual([""]);
	});
});

describe("includeServiceInMetricsConfig", () => {
	it("adds a newly deployed database to an explicit include list", () => {
		const result = includeServiceInMetricsConfig(
			createConfig(["existing-service"]),
			"workspace-workspacedb-uihovc",
		);

		expect(result.containers.services.include).toEqual([
			"existing-service",
			"workspace-workspacedb-uihovc",
		]);
	});

	it("removes an exclusion that prevents the selected database from reporting", () => {
		const result = includeServiceInMetricsConfig(
			createConfig([], ["workspace-workspacedb-uihovc"]),
			"workspace-workspacedb-uihovc",
		);

		expect(result.containers.services.include).toEqual([]);
		expect(result.containers.services.exclude).toEqual([]);
	});

	it("repairs exclude-all without enabling every container", () => {
		const result = includeServiceInMetricsConfig(
			createConfig([], ["*"]),
			"workspace-workspacedb-uihovc",
		);

		expect(result.containers.services.include).toEqual([
			"workspace-workspacedb-uihovc",
		]);
		expect(result.containers.services.exclude).toEqual([]);
	});
});

describe("getMonitoringImage", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses an explicitly configured monitoring image", () => {
		vi.stubEnv("DOKPLOY_MONITORING_IMAGE", "registry.example/monitoring:v1");

		expect(getMonitoringImage()).toBe("registry.example/monitoring:v1");
	});

	it("derives the companion image published by a custom GHCR build", () => {
		vi.stubEnv("DOKPLOY_MONITORING_IMAGE", "");
		vi.stubEnv("DOKPLOY_IMAGE", "ghcr.io/realsannimith/self-dokploy");
		vi.stubEnv("RELEASE_TAG", "custom");

		expect(getMonitoringImage()).toBe(
			"ghcr.io/realsannimith/self-dokploy:monitoring-custom",
		);
	});
});
