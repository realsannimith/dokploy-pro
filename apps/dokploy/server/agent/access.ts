export interface TelegramSender {
	id: number;
	username?: string;
}

export const parseAllowlist = (raw?: string | null) =>
	(raw || "")
		.split(/[\s,]+/)
		.map((entry) => entry.trim().replace(/^@/, "").toLowerCase())
		.filter(Boolean);

export const isAllowed = (allowlist: string[], from?: TelegramSender) => {
	if (!from) return false;
	if (allowlist.length === 0) return false;
	return (
		allowlist.includes(String(from.id)) ||
		(from.username ? allowlist.includes(from.username.toLowerCase()) : false)
	);
};
