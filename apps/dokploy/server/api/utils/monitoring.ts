import {
	execAsyncRemote,
	findApplicationById,
	findComposeById,
	findLibsqlById,
	findMariadbById,
	findMongoById,
	findMySqlById,
	findPostgresById,
	findRedisById,
	findServerById,
	getAccessibleServerIds,
	getContainersByAppNameMatch,
	getWebServerSettings,
} from "@dokploy/server";
import {
	checkServiceAccess,
	type PermissionCtx,
} from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";

export const MONITORING_SERVICE_TYPES = [
	"application",
	"compose",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
	"libsql",
] as const;

export type MonitoringServiceType = (typeof MONITORING_SERVICE_TYPES)[number];

export const MONITORING_DATA_POINTS = [
	"50",
	"200",
	"500",
	"800",
	"1200",
	"1600",
	"2000",
	"all",
] as const;

export type MonitoringDataPoints = (typeof MONITORING_DATA_POINTS)[number];

export interface MonitoringEndpoint {
	url: string;
	token: string;
	/** Enables a private SSH fallback when the monitoring port is firewalled. */
	serverId?: string;
}

type MetricsSession = { userId: string; activeOrganizationId: string };

const DIRECT_MONITORING_TIMEOUT_MS = 4_000;
const DIRECT_MONITORING_RETRY_MS = 5 * 60_000;
const preferSshUntil = new Map<string, number>();

const monitoringUrl = (host: string, port: number, path: string) => {
	const urlHost =
		host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	return new URL(path, `http://${urlHost}:${port}`).toString();
};

const parseMonitoringBody = (body: string, status: number) => {
	if (status < 200 || status >= 300) {
		throw new Error(
			`Monitoring returned HTTP ${status}. Verify that the monitoring agent is running and its token is current.`,
		);
	}
	try {
		return JSON.parse(body) as unknown;
	} catch {
		throw new Error("The monitoring agent returned an invalid response.");
	}
};

const fetchMonitoringOverSsh = async (
	endpoint: MonitoringEndpoint & { serverId: string },
	url: URL,
) => {
	const port = Number.parseInt(url.port || "80", 10);
	if (url.protocol !== "http:" || !Number.isInteger(port)) {
		throw new Error("The remote monitoring endpoint is invalid.");
	}

	const localUrl = `http://127.0.0.1:${port}${url.pathname}${url.search}`;
	const quotedUrl = `'${localUrl.replaceAll("'", `'"'"'`)}'`;
	const command = [
		"DOKPLOY_MONITORING_TOKEN=$(base64 -d)",
		[
			"curl --silent --show-error --max-time 15",
			'--header "Authorization: Bearer $DOKPLOY_MONITORING_TOKEN"',
			"--write-out '\\n%{http_code}'",
			quotedUrl,
		].join(" "),
	].join("\n");

	const { stdout } = await execAsyncRemote(
		endpoint.serverId,
		command,
		undefined,
		Buffer.from(endpoint.token, "utf8").toString("base64"),
	);
	const statusSeparator = stdout.lastIndexOf("\n");
	if (statusSeparator < 0) {
		throw new Error("The monitoring agent returned an incomplete response.");
	}

	const body = stdout.slice(0, statusSeparator);
	const status = Number.parseInt(stdout.slice(statusSeparator + 1).trim(), 10);
	if (!Number.isInteger(status)) {
		throw new Error("The monitoring agent returned an invalid HTTP status.");
	}
	return parseMonitoringBody(body, status);
};

/**
 * Fetch metrics from the configured endpoint. Remote servers use their normal
 * HTTP route when reachable and transparently fall back to localhost over SSH,
 * so users do not need to expose the monitoring port to the public internet.
 */
export const fetchMonitoringData = async (
	endpoint: MonitoringEndpoint,
	params: Record<string, string>,
) => {
	const url = new URL(endpoint.url);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}

	const preferSsh =
		endpoint.serverId &&
		(preferSshUntil.get(endpoint.serverId) ?? 0) > Date.now();
	if (endpoint.serverId && preferSsh) {
		return await fetchMonitoringOverSsh(
			{ ...endpoint, serverId: endpoint.serverId },
			url,
		);
	}

	let response: Response;
	try {
		response = await fetch(url, {
			headers: { Authorization: `Bearer ${endpoint.token}` },
			signal: AbortSignal.timeout(DIRECT_MONITORING_TIMEOUT_MS),
		});
	} catch (directError) {
		if (!endpoint.serverId) throw directError;
		preferSshUntil.set(
			endpoint.serverId,
			Date.now() + DIRECT_MONITORING_RETRY_MS,
		);
		try {
			return await fetchMonitoringOverSsh(
				{ ...endpoint, serverId: endpoint.serverId },
				url,
			);
		} catch (sshError) {
			throw new Error(
				`Dokploy could not reach monitoring directly or through SSH. ${
					sshError instanceof Error
						? sshError.message
						: "Check the remote server connection."
				}`,
			);
		}
	}

	if (endpoint.serverId) preferSshUntil.delete(endpoint.serverId);
	return parseMonitoringBody(await response.text(), response.status);
};

export const resolveServerMonitoringTarget = async (
	serverId: string | undefined,
	session: MetricsSession,
): Promise<MonitoringEndpoint> => {
	if (serverId) {
		const targetServer = await findServerById(serverId);
		const accessibleIds = await getAccessibleServerIds(session);
		if (
			targetServer.organizationId !== session.activeOrganizationId ||
			!accessibleIds.has(serverId)
		) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "You are not authorized to access this server",
			});
		}

		const metrics = targetServer.metricsConfig?.server;
		if (!metrics?.token) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `Monitoring is not enabled on "${targetServer.name}". Go to Settings > Servers > Setup Server > Monitoring and save the configuration to start collecting metrics.`,
			});
		}

		return {
			url: monitoringUrl(targetServer.ipAddress, metrics.port, "/metrics"),
			token: metrics.token,
			serverId,
		};
	}

	if (
		process.env.NODE_ENV !== "production" &&
		process.env.NEXT_PUBLIC_METRICS_URL
	) {
		return {
			url: process.env.NEXT_PUBLIC_METRICS_URL,
			token: process.env.NEXT_PUBLIC_METRICS_TOKEN ?? "",
		};
	}

	const settings = await getWebServerSettings();
	const metrics = settings?.metricsConfig?.server;
	if (!metrics?.token) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"Monitoring is not enabled on the Dokploy server. Go to Settings > Server > Monitoring and save the configuration to start collecting metrics.",
		});
	}
	if (!settings?.serverIp) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"The Dokploy server IP is not set, so the metrics service cannot be reached. Set it in Settings > Server > Web Server.",
		});
	}

	return {
		url: monitoringUrl(settings.serverIp, metrics.port, "/metrics"),
		token: metrics.token,
	};
};

interface ResolveContainerMonitoringInput {
	serviceId: string;
	serviceType: MonitoringServiceType;
	containerName?: string;
}

interface ServiceWithMonitoringServer {
	server?: {
		metricsConfig?: {
			server?: { token?: string; [key: string]: unknown };
			[key: string]: unknown;
		};
		[key: string]: unknown;
	} | null;
}

/** Service detail responses never need to expose the monitoring bearer token. */
export const redactServiceMonitoringToken = <
	T extends ServiceWithMonitoringServer,
>(
	service: T,
): T => {
	if (!service.server?.metricsConfig?.server?.token) return service;
	return {
		...service,
		server: {
			...service.server,
			metricsConfig: {
				...service.server.metricsConfig,
				server: {
					...service.server.metricsConfig.server,
					token: "",
				},
			},
		},
	} as T;
};

const findService = async (input: ResolveContainerMonitoringInput) => {
	switch (input.serviceType) {
		case "application":
			return await findApplicationById(input.serviceId);
		case "compose":
			return await findComposeById(input.serviceId);
		case "postgres":
			return await findPostgresById(input.serviceId);
		case "mysql":
			return await findMySqlById(input.serviceId);
		case "mariadb":
			return await findMariadbById(input.serviceId);
		case "mongo":
			return await findMongoById(input.serviceId);
		case "redis":
			return await findRedisById(input.serviceId);
		case "libsql":
			return await findLibsqlById(input.serviceId);
	}
};

/** Resolve the authorized container identity shared by reads and repairs. */
export const resolveContainerMonitoringService = async (
	ctx: PermissionCtx,
	input: ResolveContainerMonitoringInput,
) => {
	await checkServiceAccess(ctx, input.serviceId, "read");
	const service = await findService(input);

	if (
		!service ||
		service.environment.project.organizationId !==
			ctx.session.activeOrganizationId
	) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to monitor this service",
		});
	}

	let containerName = service.appName;
	if (input.containerName && input.containerName !== service.appName) {
		if (input.serviceType !== "compose") {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "The requested container does not belong to this service",
			});
		}

		const containers = await getContainersByAppNameMatch(
			service.appName,
			(service as Awaited<ReturnType<typeof findComposeById>>).composeType,
			service.serverId ?? undefined,
		);
		if (
			!containers.some((container) => container.name === input.containerName)
		) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message:
					"The requested container does not belong to this compose service",
			});
		}
		containerName = input.containerName;
	}

	return {
		containerName,
		serverId: service.serverId ?? undefined,
	};
};

/**
 * Resolve a container-metrics endpoint from an authorized service. Users with
 * access to an application/database may see its metrics without receiving the
 * remote server's monitoring token or needing broad server access.
 */
export const resolveContainerMonitoringTarget = async (
	ctx: PermissionCtx,
	input: ResolveContainerMonitoringInput,
) => {
	const { containerName, serverId } = await resolveContainerMonitoringService(
		ctx,
		input,
	);

	if (serverId) {
		const targetServer = await findServerById(serverId);
		if (targetServer.organizationId !== ctx.session.activeOrganizationId) {
			throw new TRPCError({
				code: "UNAUTHORIZED",
				message: "You are not authorized to access this monitoring target",
			});
		}
		const metrics = targetServer.metricsConfig?.server;
		if (!metrics?.token) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `Monitoring is not enabled on "${targetServer.name}". Ask an administrator to enable it in Settings > Servers > Setup Server > Monitoring.`,
			});
		}
		return {
			url: monitoringUrl(
				targetServer.ipAddress,
				metrics.port,
				"/metrics/containers",
			),
			token: metrics.token,
			containerName,
			serverId: targetServer.serverId,
		};
	}

	const settings = await getWebServerSettings();
	const metrics = settings?.metricsConfig?.server;
	if (!metrics?.token || !settings?.serverIp) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"Monitoring is not enabled on the Dokploy server. Ask an administrator to configure it in Settings > Server > Monitoring.",
		});
	}
	return {
		url: monitoringUrl(settings.serverIp, metrics.port, "/metrics/containers"),
		token: metrics.token,
		containerName,
	};
};
