import type { OverviewService } from "@dokploy/server/services/overview";
import {
	DEPLOYABLE_SERVICE_TYPES,
	getOverviewStatusLabel,
	sortOverviewServices,
} from "@dokploy/server/services/overview";
import { describe, expect, test } from "vitest";

const makeService = (overrides: Partial<OverviewService>): OverviewService => ({
	id: "id",
	type: "application",
	name: "name",
	appName: "app-name",
	status: "running",
	createdAt: "2024-01-01T00:00:00.000Z",
	serverId: null,
	serverName: null,
	icon: null,
	projectId: "project",
	projectName: "Project",
	environmentId: "environment",
	environmentName: "Environment",
	lastDeployAt: null,
	...overrides,
});

describe("sortOverviewServices", () => {
	test("sorts by name asc/desc", () => {
		const services = [
			makeService({ id: "b", name: "Bravo" }),
			makeService({ id: "a", name: "Alpha" }),
			makeService({ id: "c", name: "Charlie" }),
		];

		expect(sortOverviewServices(services, "name-asc").map((s) => s.id)).toEqual(
			["a", "b", "c"],
		);
		expect(
			sortOverviewServices(services, "name-desc").map((s) => s.id),
		).toEqual(["c", "b", "a"]);
	});

	test("sorts by type asc/desc", () => {
		const services = [
			makeService({ id: "app", type: "application" }),
			makeService({ id: "pg", type: "postgres" }),
			makeService({ id: "comp", type: "compose" }),
		];

		expect(sortOverviewServices(services, "type-asc").map((s) => s.id)).toEqual(
			["app", "comp", "pg"],
		);
		expect(
			sortOverviewServices(services, "type-desc").map((s) => s.id),
		).toEqual(["pg", "comp", "app"]);
	});

	test("sorts by createdAt asc/desc", () => {
		const services = [
			makeService({ id: "old", createdAt: "2023-01-01T00:00:00.000Z" }),
			makeService({ id: "new", createdAt: "2024-06-01T00:00:00.000Z" }),
			makeService({ id: "mid", createdAt: "2023-12-01T00:00:00.000Z" }),
		];

		expect(
			sortOverviewServices(services, "createdAt-asc").map((s) => s.id),
		).toEqual(["old", "mid", "new"]);
		expect(
			sortOverviewServices(services, "createdAt-desc").map((s) => s.id),
		).toEqual(["new", "mid", "old"]);
	});

	test("sorts by lastDeploy asc/desc, with never-deployed services always last", () => {
		const services = [
			makeService({ id: "never", lastDeployAt: null }),
			makeService({ id: "old", lastDeployAt: "2023-01-01T00:00:00.000Z" }),
			makeService({ id: "new", lastDeployAt: "2024-06-01T00:00:00.000Z" }),
		];

		expect(
			sortOverviewServices(services, "lastDeploy-desc").map((s) => s.id),
		).toEqual(["new", "old", "never"]);
		expect(
			sortOverviewServices(services, "lastDeploy-asc").map((s) => s.id),
		).toEqual(["old", "new", "never"]);
	});

	test("lastDeploy sort with all services never deployed is a no-op", () => {
		const services = [
			makeService({ id: "a", lastDeployAt: null }),
			makeService({ id: "b", lastDeployAt: null }),
		];

		expect(
			sortOverviewServices(services, "lastDeploy-desc").map((s) => s.id),
		).toEqual(["a", "b"]);
	});

	test("falls back to newest-first when nothing has a deploy date", () => {
		const services = [
			makeService({
				id: "old",
				type: "postgres",
				createdAt: "2024-01-01T00:00:00.000Z",
			}),
			makeService({
				id: "new",
				type: "postgres",
				createdAt: "2024-06-01T00:00:00.000Z",
			}),
			makeService({
				id: "mid",
				type: "redis",
				createdAt: "2024-03-01T00:00:00.000Z",
			}),
		];

		expect(
			sortOverviewServices(services, "lastDeploy-desc").map((s) => s.id),
		).toEqual(["new", "mid", "old"]);
	});

	test("keeps deployed services ahead of the createdAt fallback group", () => {
		const services = [
			makeService({ id: "db-new", createdAt: "2025-01-01T00:00:00.000Z" }),
			makeService({ id: "app", lastDeployAt: "2020-01-01T00:00:00.000Z" }),
		];

		expect(
			sortOverviewServices(services, "lastDeploy-desc").map((s) => s.id),
		).toEqual(["app", "db-new"]);
	});

	test("does not mutate the input array", () => {
		const services = [
			makeService({ id: "b", name: "Bravo" }),
			makeService({ id: "a", name: "Alpha" }),
		];
		const original = [...services];

		sortOverviewServices(services, "name-asc");

		expect(services).toEqual(original);
	});
});

describe("overview service metadata", () => {
	test("only application and compose own deployment history", () => {
		expect(DEPLOYABLE_SERVICE_TYPES.has("application")).toBe(true);
		expect(DEPLOYABLE_SERVICE_TYPES.has("compose")).toBe(true);
		for (const type of [
			"postgres",
			"mysql",
			"mariadb",
			"mongo",
			"redis",
			"libsql",
		] as const) {
			expect(DEPLOYABLE_SERVICE_TYPES.has(type)).toBe(false);
		}
	});

	test("labels the steady state as Running and the mid-deploy state as Deploying", () => {
		expect(getOverviewStatusLabel("done")).toBe("Running");
		expect(getOverviewStatusLabel("running")).toBe("Deploying");
		expect(getOverviewStatusLabel("idle")).toBe("Idle");
		expect(getOverviewStatusLabel("error")).toBe("Error");
		expect(getOverviewStatusLabel(null)).toBe("Unknown");
		expect(getOverviewStatusLabel("something-else")).toBe("Unknown");
	});
});
