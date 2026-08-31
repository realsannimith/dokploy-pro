export type ApplicationDomainLinkInput = {
	enabled: boolean;
	host: string;
	https: boolean;
	path?: string | null;
};

export type ApplicationDomainLink = {
	href: string;
	host: string;
	isTemporaryHttpDomain: boolean;
};

const UNSAFE_HOST_CHARACTERS = /[\s\\/:?#@]/u;

export const buildApplicationDomainUrl = (
	domain: Pick<ApplicationDomainLinkInput, "host" | "https" | "path">,
): string | null => {
	const host = domain.host.trim();
	if (!host || host !== domain.host || UNSAFE_HOST_CHARACTERS.test(host)) {
		return null;
	}

	try {
		const protocol = domain.https ? "https:" : "http:";
		const url = new URL(`${protocol}//${host}`);

		if (url.protocol !== protocol || url.username || url.password || url.port) {
			return null;
		}

		const path = domain.path || "/";
		url.pathname = path.startsWith("/") ? path : `/${path}`;

		return url.toString();
	} catch {
		return null;
	}
};

export const getFirstEnabledApplicationDomainLink = (
	domains?: readonly ApplicationDomainLinkInput[] | null,
): ApplicationDomainLink | null => {
	const domain = domains?.find((candidate) => candidate.enabled);
	if (!domain) {
		return null;
	}

	const href = buildApplicationDomainUrl(domain);
	if (!href) {
		return null;
	}

	const normalizedHost = domain.host.toLowerCase().replace(/\.$/u, "");
	const isSslipDomain =
		normalizedHost === "sslip.io" || normalizedHost.endsWith(".sslip.io");

	return {
		href,
		host: domain.host,
		isTemporaryHttpDomain: isSslipDomain && !domain.https,
	};
};
