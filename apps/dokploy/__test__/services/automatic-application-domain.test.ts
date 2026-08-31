import type { ApplicationNested } from "@dokploy/server/utils/builders";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	findServerByIdMock,
	getWebServerSettingsMock,
	manageDomainMock,
	transactionMock,
} = vi.hoisted(() => ({
	findServerByIdMock: vi.fn(),
	getWebServerSettingsMock: vi.fn(),
	manageDomainMock: vi.fn(),
	transactionMock: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	db: { transaction: transactionMock },
}));

vi.mock("@dokploy/server/services/server", () => ({
	findServerById: findServerByIdMock,
}));

vi.mock("@dokploy/server/services/web-server-settings", () => ({
	getWebServerSettings: getWebServerSettingsMock,
}));

vi.mock("@dokploy/server/utils/traefik/domain", () => ({
	manageDomain: manageDomainMock,
}));

import {
	ensureAutomaticApplicationDomain,
	getAutomaticApplicationDomainPort,
} from "@dokploy/server/services/automatic-application-domain";

const application = (
	overrides: Partial<ApplicationNested> = {},
): ApplicationNested =>
	({
		applicationId: "application-1",
		appName: "app-example",
		buildType: "nixpacks",
		env: "NODE_ENV=production",
		serverId: null,
		environment: {
			env: "",
			project: { env: "" },
		},
		mounts: [],
		ports: [],
		redirects: [],
		security: [],
		...overrides,
	}) as ApplicationNested;

const createTransactionHarness = ({
	existingDomain = null as { domainId: string } | null,
	hasSuccessfulDeployment = false,
} = {}) => {
	let currentDomain = existingDomain;
	let insertedValues: Record<string, unknown> | undefined;
	let queue = Promise.resolve();

	const tx = {
		execute: vi.fn().mockResolvedValue([]),
		query: {
			domains: {
				findFirst: vi.fn(async () => currentDomain),
			},
			deployments: {
				findFirst: vi.fn(async () =>
					hasSuccessfulDeployment ? { deploymentId: "deployment-done" } : null,
				),
			},
		},
		insert: vi.fn(() => ({
			values: vi.fn((values: Record<string, unknown>) => {
				insertedValues = values;
				return {
					returning: vi.fn(async () => {
						const domain = {
							domainId: "domain-automatic",
							uniqueConfigKey: 1,
							...values,
						};
						currentDomain = domain;
						return [domain];
					}),
				};
			}),
		})),
	};

	transactionMock.mockImplementation(async (callback) => {
		const previous = queue;
		let release = () => {};
		queue = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await callback(tx);
		} finally {
			release();
		}
	});

	return {
		getInsertedValues: () => insertedValues,
		tx,
	};
};

describe("automatic first-deployment application domain", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		findServerByIdMock.mockResolvedValue({ ipAddress: "203.0.113.10" });
		getWebServerSettingsMock.mockResolvedValue({ serverIp: "198.51.100.20" });
		manageDomainMock.mockResolvedValue(undefined);
	});

	it("uses the local Dokploy IP for a local deployment", async () => {
		const harness = createTransactionHarness();

		const result = await ensureAutomaticApplicationDomain({
			application: application(),
		});

		expect(result.status).toBe("created");
		expect(harness.getInsertedValues()).toMatchObject({
			applicationId: "application-1",
			certificateType: "none",
			domainType: "application",
			https: false,
			path: "/",
			port: 3000,
		});
		expect(harness.getInsertedValues()?.host).toMatch(
			/^app-example-[a-f0-9]{6}-198-51-100-20\.sslip\.io$/,
		);
		expect(getWebServerSettingsMock).toHaveBeenCalledOnce();
		expect(findServerByIdMock).not.toHaveBeenCalled();
	});

	it("uses the deployment server IP rather than a build server", async () => {
		const harness = createTransactionHarness();

		await ensureAutomaticApplicationDomain({
			application: application({
				serverId: "deploy-server",
				buildServerId: "build-server",
			}),
		});

		expect(findServerByIdMock).toHaveBeenCalledWith("deploy-server");
		expect(harness.getInsertedValues()?.host).toMatch(
			/^app-example-[a-f0-9]{6}-203-0-113-10\.sslip\.io$/,
		);
		expect(getWebServerSettingsMock).not.toHaveBeenCalled();
	});

	it("does not add a domain when the application already has one", async () => {
		const harness = createTransactionHarness({
			existingDomain: { domainId: "user-domain" },
		});
		getWebServerSettingsMock.mockResolvedValue({ serverIp: null });

		await expect(
			ensureAutomaticApplicationDomain({
				application: application(),
			}),
		).resolves.toEqual({ status: "skipped", reason: "domain-exists" });
		expect(harness.tx.insert).not.toHaveBeenCalled();
	});

	it("does not add a domain after an earlier successful deployment", async () => {
		const harness = createTransactionHarness({
			hasSuccessfulDeployment: true,
		});
		getWebServerSettingsMock.mockResolvedValue({ serverIp: null });

		await expect(
			ensureAutomaticApplicationDomain({
				application: application(),
			}),
		).resolves.toEqual({
			status: "skipped",
			reason: "previously-deployed",
		});
		expect(harness.tx.insert).not.toHaveBeenCalled();
	});

	it("creates the domain after an earlier failed deployment", async () => {
		const harness = createTransactionHarness({
			hasSuccessfulDeployment: false,
		});

		await expect(
			ensureAutomaticApplicationDomain({ application: application() }),
		).resolves.toMatchObject({ status: "created" });
		expect(harness.tx.insert).toHaveBeenCalledOnce();
	});

	it("skips without failing when the deployment IP is missing or invalid", async () => {
		const harness = createTransactionHarness();
		getWebServerSettingsMock.mockResolvedValue({ serverIp: "not-an-ip" });

		await expect(
			ensureAutomaticApplicationDomain({
				application: application(),
			}),
		).resolves.toEqual({ status: "skipped", reason: "missing-ip" });
		expect(harness.tx.insert).not.toHaveBeenCalled();
	});

	it("serializes retried claims and creates only one domain", async () => {
		const harness = createTransactionHarness();
		const input = {
			application: application(),
		};

		const results = await Promise.all([
			ensureAutomaticApplicationDomain(input),
			ensureAutomaticApplicationDomain(input),
		]);

		expect(results.map((result) => result.status).sort()).toEqual([
			"created",
			"skipped",
		]);
		expect(harness.tx.execute).toHaveBeenCalledTimes(2);
		expect(harness.tx.insert).toHaveBeenCalledOnce();
		expect(manageDomainMock).toHaveBeenCalledOnce();
	});
});

describe("automatic application domain port", () => {
	it("uses port 80 for static applications", () => {
		expect(
			getAutomaticApplicationDomainPort(
				application({ buildType: "static", env: "PORT=4173" }),
			),
		).toBe(80);
	});

	it("uses a valid PORT from the effective service environment", () => {
		expect(
			getAutomaticApplicationDomainPort(
				application({
					env: "PORT=${{environment.APP_PORT}}",
					environment: {
						env: "APP_PORT=8080",
						project: { env: "" },
					} as ApplicationNested["environment"],
				}),
			),
		).toBe(8080);
	});

	it.each(["", "PORT=0", "PORT=65536", "PORT=not-a-number"])(
		"falls back to port 3000 for %s",
		(env) => {
			expect(getAutomaticApplicationDomainPort(application({ env }))).toBe(
				3000,
			);
		},
	);
});
