import {
	findApplicationById,
	findComposeById,
	findLibsqlById,
	findMariadbById,
	findMongoById,
	findMySqlById,
	findPostgresById,
	findRedisById,
	findServerById,
	getContainersByAppNameMatch,
	getWebServerSettings,
} from "@dokploy/server";
import {
	checkServiceAccess,
	type PermissionCtx,
} from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";

export type MonitoringServiceType =
	| "application"
	| "compose"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "libsql";

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

/**
 * Resolve a container-metrics endpoint from an authorized service. Users with
 * access to an application/database may see its metrics without receiving the
 * remote server's monitoring token or needing broad server access.
 */
export const resolveContainerMonitoringTarget = async (
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

	if (service.serverId) {
		const targetServer = await findServerById(service.serverId);
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
			url: `http://${targetServer.ipAddress}:${metrics.port}/metrics/containers`,
			token: metrics.token,
			containerName,
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
		url: `http://${settings.serverIp}:${metrics.port}/metrics/containers`,
		token: metrics.token,
		containerName,
	};
};
