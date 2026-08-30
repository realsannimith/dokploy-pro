import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canGenerateOrganizationScimToken } from "@dokploy/server/services/proprietary/scim";
import { describe, expect, it } from "vitest";

const dokployRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(dokployRoot, "../..");
const serverPackageRoot = path.join(repositoryRoot, "packages/server");

const collectSourceFiles = (directory: string): string[] =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return collectSourceFiles(entryPath);
		}
		return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : [];
	});

describe("license-free runtime wiring", () => {
	it("does not retain the license router, remote API helpers, or validation cron", () => {
		const removedRuntimeFiles = [
			path.join(dokployRoot, "server/api/routers/proprietary/license-key.ts"),
			path.join(dokployRoot, "server/utils/enterprise.ts"),
			path.join(serverPackageRoot, "src/services/proprietary/license-key.ts"),
			path.join(serverPackageRoot, "src/utils/crons/enterprise.ts"),
		];

		for (const file of removedRuntimeFiles) {
			expect(existsSync(file), path.relative(repositoryRoot, file)).toBe(false);
		}

		const activeSourceFiles = [
			...collectSourceFiles(path.join(dokployRoot, "server")),
			...collectSourceFiles(path.join(dokployRoot, "components")),
			...collectSourceFiles(path.join(dokployRoot, "hooks")),
			...collectSourceFiles(path.join(dokployRoot, "lib")),
			...collectSourceFiles(path.join(dokployRoot, "pages")),
			...collectSourceFiles(path.join(dokployRoot, "utils")),
			...collectSourceFiles(path.join(serverPackageRoot, "src")),
		];
		const forbiddenReferences = [
			"licenses-api.dokploy.com",
			"LICENSE_KEY_URL",
			"licenseKey",
			"licenseKeyRouter",
			"hasValidLicense",
			"haveValidLicenseKey",
			"enableEnterpriseFeatures",
			"isValidEnterpriseLicense",
			"initEnterpriseBackupCronJobs",
			"enterpriseProcedure",
			"EnterpriseFeatureGate",
			"EnterpriseFeatureLocked",
			"/dashboard/settings/license",
			"/licenses/activate",
			"/licenses/deactivate",
			"/licenses/validate",
			"services/proprietary/license-key",
			"utils/crons/enterprise",
		];
		const offenders: string[] = [];

		for (const file of activeSourceFiles) {
			const source = readFileSync(file, "utf8");
			for (const reference of forbiddenReferences) {
				if (source.includes(reference)) {
					offenders.push(
						`${path.relative(repositoryRoot, file)}: ${reference}`,
					);
				}
			}
		}

		expect(offenders).toEqual([]);
	});

	it("wires the organization-scoped guard into SCIM token generation", () => {
		const authSource = readFileSync(
			path.join(serverPackageRoot, "src/lib/auth.ts"),
			"utf8",
		);

		expect(authSource).not.toContain("beforeSCIMTokenGenerated");
		expect(authSource).toContain(
			"canGenerateToken: canGenerateOrganizationScimToken",
		);
	});
});

describe("canGenerateOrganizationScimToken", () => {
	it.each([
		{ label: "present", organizationId: "org-1", expected: true },
		{ label: "empty", organizationId: "", expected: false },
		{ label: "missing", organizationId: undefined, expected: false },
	])(
		"returns $expected when organizationId is $label",
		({ organizationId, expected }) => {
			expect(canGenerateOrganizationScimToken({ organizationId })).toBe(
				expected,
			);
		},
	);
});
