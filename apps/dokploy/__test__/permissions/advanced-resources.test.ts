import {
	advancedResources,
	statements,
} from "@dokploy/server/lib/access-control";
import { describe, expect, it } from "vitest";

const CORE_RESOURCES = [
	"organization",
	"member",
	"invitation",
	"team",
	"ac",
	"project",
	"service",
	"environment",
	"docker",
	"sshKeys",
	"gitProviders",
	"traefikFiles",
	"api",
];

const ADVANCED_RESOURCES = [
	"volume",
	"deployment",
	"envVars",
	"projectEnvVars",
	"environmentEnvVars",
	"server",
	"registry",
	"certificate",
	"backup",
	"volumeBackup",
	"schedule",
	"domain",
	"destination",
	"notification",
	"tag",
	"logs",
	"monitoring",
	"auditLog",
	"vaultProvider",
	"dnsProvider",
];

describe("advancedResources", () => {
	it("contains all advanced resources", () => {
		for (const resource of ADVANCED_RESOURCES) {
			expect(advancedResources.has(resource)).toBe(true);
		}
	});

	it("does not contain core resources", () => {
		for (const resource of CORE_RESOURCES) {
			expect(advancedResources.has(resource)).toBe(false);
		}
	});

	it("every resource in statements is either core or advanced", () => {
		const allResources = Object.keys(statements);
		for (const resource of allResources) {
			const isCore = CORE_RESOURCES.includes(resource);
			const isAdvanced = advancedResources.has(resource);
			expect(isCore || isAdvanced).toBe(true);
		}
	});

	it("core and advanced sets don't overlap", () => {
		for (const resource of CORE_RESOURCES) {
			expect(advancedResources.has(resource)).toBe(false);
		}
	});

	it("all statement resources are accounted for", () => {
		const allResources = Object.keys(statements);
		const categorized = [...CORE_RESOURCES, ...ADVANCED_RESOURCES];
		for (const resource of allResources) {
			expect(categorized).toContain(resource);
		}
	});
});
