import { describe, expect, it } from "vitest";
import { developerRolePermissions } from "../../lib/custom-role-presets";

describe("developer role preset", () => {
	it("can deploy and manage its own Git provider connections", () => {
		expect(developerRolePermissions.deployment).toContain("create");
		expect(developerRolePermissions.gitProviders).toEqual([
			"read",
			"create",
			"delete",
		]);
	});
});
