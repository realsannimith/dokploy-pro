import { beforeEach, describe, expect, it, vi } from "vitest";

let memberRecord = {
	role: "member",
	accessedServers: ["server-1"],
};

const organizationServers = [
	{ serverId: "server-1" },
	{ serverId: "server-2" },
];

vi.mock("@dokploy/server/db", () => ({
	db: {
		query: {
			server: {
				findMany: vi.fn(() => Promise.resolve(organizationServers)),
			},
			member: {
				findFirst: vi.fn(() => Promise.resolve(memberRecord)),
			},
		},
	},
}));

const { getAccessibleServerIds } = await import(
	"@dokploy/server/services/server"
);

const session = { userId: "user-1", activeOrganizationId: "org-1" };

beforeEach(() => {
	memberRecord = {
		role: "member",
		accessedServers: ["server-1"],
	};
});

describe("license-free remote server assignment", () => {
	it("returns only explicitly assigned servers for a member", async () => {
		const result = await getAccessibleServerIds(session);
		expect([...result]).toEqual(["server-1"]);
	});

	it("does not fall back to every organization server", async () => {
		memberRecord = { ...memberRecord, accessedServers: [] };
		const result = await getAccessibleServerIds(session);
		expect([...result]).toEqual([]);
	});

	it.each(["owner", "admin"])(
		"returns every organization server for %s",
		async (role) => {
			memberRecord = { ...memberRecord, role };
			const result = await getAccessibleServerIds(session);
			expect([...result].sort()).toEqual(["server-1", "server-2"]);
		},
	);
});
