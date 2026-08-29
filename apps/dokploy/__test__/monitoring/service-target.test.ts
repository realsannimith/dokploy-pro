import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	checkServiceAccess: vi.fn(),
	findApplicationById: vi.fn(),
	findComposeById: vi.fn(),
	findLibsqlById: vi.fn(),
	findMariadbById: vi.fn(),
	findMongoById: vi.fn(),
	findMySqlById: vi.fn(),
	findPostgresById: vi.fn(),
	findRedisById: vi.fn(),
	findServerById: vi.fn(),
	getContainersByAppNameMatch: vi.fn(),
	getWebServerSettings: vi.fn(),
}));

vi.mock("@dokploy/server", () => ({
	findApplicationById: mocks.findApplicationById,
	findComposeById: mocks.findComposeById,
	findLibsqlById: mocks.findLibsqlById,
	findMariadbById: mocks.findMariadbById,
	findMongoById: mocks.findMongoById,
	findMySqlById: mocks.findMySqlById,
	findPostgresById: mocks.findPostgresById,
	findRedisById: mocks.findRedisById,
	findServerById: mocks.findServerById,
	getContainersByAppNameMatch: mocks.getContainersByAppNameMatch,
	getWebServerSettings: mocks.getWebServerSettings,
}));

vi.mock("@dokploy/server/services/permission", () => ({
	checkServiceAccess: mocks.checkServiceAccess,
}));

const { redactServiceMonitoringToken, resolveContainerMonitoringTarget } =
	await import("@/server/api/utils/monitoring");

const ctx = {
	user: { id: "user-1" },
	session: { activeOrganizationId: "org-1" },
};

const application = {
	appName: "app-api-123",
	serverId: "server-1",
	environment: { project: { organizationId: "org-1" } },
};

describe("service-scoped remote monitoring", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.findApplicationById.mockResolvedValue(application);
		mocks.findServerById.mockResolvedValue({
			serverId: "server-1",
			name: "Production",
			organizationId: "org-1",
			ipAddress: "10.0.0.5",
			metricsConfig: { server: { port: 4500, token: "server-secret" } },
		});
	});

	it("lets a service-authorized user resolve remote metrics without server access", async () => {
		await expect(
			resolveContainerMonitoringTarget(ctx, {
				serviceId: "app-1",
				serviceType: "application",
				containerName: "app-api-123",
			}),
		).resolves.toEqual({
			url: "http://10.0.0.5:4500/metrics/containers",
			token: "server-secret",
			containerName: "app-api-123",
		});
		expect(mocks.checkServiceAccess).toHaveBeenCalledWith(ctx, "app-1", "read");
	});

	it("redacts monitoring tokens from service detail responses", () => {
		const service = {
			server: {
				name: "Production",
				metricsConfig: {
					server: { token: "server-secret", port: 4500 },
				},
			},
		};

		expect(
			redactServiceMonitoringToken(service).server.metricsConfig.server.token,
		).toBe("");
		expect(service.server.metricsConfig.server.token).toBe("server-secret");
	});

	it("rejects a container name outside the authorized service", async () => {
		await expect(
			resolveContainerMonitoringTarget(ctx, {
				serviceId: "app-1",
				serviceType: "application",
				containerName: "another-customer-app",
			}),
		).rejects.toThrow("does not belong to this service");
	});

	it("validates selected compose containers against the remote service", async () => {
		mocks.findComposeById.mockResolvedValue({
			...application,
			appName: "compose-store-123",
			composeType: "docker-compose",
		});
		mocks.getContainersByAppNameMatch.mockResolvedValue([
			{ name: "compose-store-123-api-1" },
		]);

		const target = await resolveContainerMonitoringTarget(ctx, {
			serviceId: "compose-1",
			serviceType: "compose",
			containerName: "compose-store-123-api-1",
		});

		expect(target.containerName).toBe("compose-store-123-api-1");
		expect(mocks.getContainersByAppNameMatch).toHaveBeenCalledWith(
			"compose-store-123",
			"docker-compose",
			"server-1",
		);
	});
});
