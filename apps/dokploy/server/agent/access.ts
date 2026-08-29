export interface TelegramSender {
	id: number;
	username?: string;
}

export const parseAllowlist = (raw?: string | null) =>
	(raw || "")
		.split(/[\s,]+/)
		.map((entry) => entry.trim().replace(/^@/, "").toLowerCase())
		.filter(Boolean);

/**
 * Allowlists are deny-by-default: an empty list lets nobody in, so a
 * misconfigured channel can never expose the agent to the public.
 */
export const matchesAllowlist = (
	allowlist: string[],
	identifiers: Array<string | number | undefined | null>,
) => {
	if (allowlist.length === 0) return false;
	return identifiers.some((identifier) => {
		if (identifier === undefined || identifier === null) return false;
		const value = String(identifier).trim().replace(/^@/, "").toLowerCase();
		return value.length > 0 && allowlist.includes(value);
	});
};

export const isAllowed = (allowlist: string[], from?: TelegramSender) => {
	if (!from) return false;
	return matchesAllowlist(allowlist, [from.id, from.username]);
};
