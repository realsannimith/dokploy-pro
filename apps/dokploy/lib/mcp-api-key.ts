export const buildMcpApiKeyInput = (
	organizationId: string,
	createdAt = new Date(),
) => ({
	name: `mcp-agent-${createdAt.toISOString().slice(0, 10)}`,
	metadata: { organizationId },
	// Better Auth otherwise defaults to 10 requests per 24 hours, which an MCP
	// client can exhaust during its initial tool discovery.
	rateLimitEnabled: false,
});

type SessionKeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const storageKey = (organizationId: string) =>
	`dokploy:mcp-api-key:${organizationId}`;

export const loadMcpApiKey = (
	storage: SessionKeyStorage,
	organizationId: string,
) => {
	try {
		return storage.getItem(storageKey(organizationId)) ?? "";
	} catch {
		return "";
	}
};

export const rememberMcpApiKey = (
	storage: SessionKeyStorage,
	organizationId: string,
	apiKey: string,
) => {
	try {
		if (apiKey) {
			storage.setItem(storageKey(organizationId), apiKey);
		} else {
			storage.removeItem(storageKey(organizationId));
		}
	} catch {
		// Some privacy modes disable browser storage; the in-memory value still works.
	}
};

export const forgetMcpApiKey = (
	storage: SessionKeyStorage,
	organizationId: string,
) => {
	try {
		storage.removeItem(storageKey(organizationId));
	} catch {
		// The key is still removed from React state by the caller.
	}
};
