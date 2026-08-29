import { getDokployUrl } from "@dokploy/server/services/admin";
import {
	findServerById,
	updateServerById,
} from "@dokploy/server/services/server";
import {
	getWebServerSettings,
	updateWebServerSettings,
} from "@dokploy/server/services/web-server-settings";
import type { CreateServiceOptions } from "dockerode";
import { IS_CLOUD } from "../constants";
import { getDokployImage, getDokployImageTag } from "../services/settings";
import { pullImage, pullRemoteImage } from "../utils/docker/utils";
import { execAsync, execAsyncRemote } from "../utils/process/execAsync";
import { getRemoteDocker } from "../utils/servers/remote-docker";

export const getMonitoringImage = () => {
	const configuredImage = process.env.DOKPLOY_MONITORING_IMAGE?.trim();
	if (configuredImage) {
		return configuredImage;
	}

	// This fork publishes its monitoring binary beside the main Dokploy image.
	// Keep official installs on Docker Hub while allowing a custom GHCR build to
	// ship collector fixes without depending on upstream image publication.
	if (process.env.DOKPLOY_IMAGE && getDokployImage().startsWith("ghcr.io/")) {
		return `${getDokployImage()}:monitoring-${getDokployImageTag()}`;
	}

	let imageName = "dokploy/monitoring:latest";

	if (
		(getDokployImageTag() !== "latest" ||
			process.env.NODE_ENV === "development") &&
		!IS_CLOUD
	) {
		imageName = "dokploy/monitoring:canary";
	}

	return imageName;
};

// Swarm tasks are dokploy-monitoring.<slot>.<id>, so this only matches the
// pre-v0.30.0 standalone container. A cleanup failure must not block the deploy.
const removeLegacyContainer = async (
	docker: Awaited<ReturnType<typeof getRemoteDocker>>,
	serviceName: string,
) => {
	try {
		await docker.getContainer(serviceName).remove({ force: true });
		console.log("Removed legacy monitoring container ✅");
	} catch (error: any) {
		if (error?.statusCode !== 404) {
			console.warn(
				`Could not remove legacy monitoring container: ${error?.message ?? error}`,
			);
		}
	}
};

const deployMonitoringService = async (
	docker: Awaited<ReturnType<typeof getRemoteDocker>>,
	serviceName: string,
	settings: CreateServiceOptions,
) => {
	await removeLegacyContainer(docker, serviceName);

	try {
		const service = docker.getService(serviceName);
		const inspect = await service.inspect();
		await service.update({
			version: Number.parseInt(inspect.Version.Index, 10),
			...settings,
			TaskTemplate: {
				...settings.TaskTemplate,
				ForceUpdate: (inspect.Spec.TaskTemplate.ForceUpdate ?? 0) + 1,
			},
		});
		console.log("Monitoring Updated ✅");
	} catch (error: any) {
		if (error?.statusCode && error.statusCode !== 404) {
			throw error;
		}
		await docker.createService(settings);
		console.log("Monitoring Started ✅");
	}
};

const generateMetricsToken = () => {
	const array = new Uint8Array(64);
	crypto.getRandomValues(array);
	return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
};

type MetricsConfig = {
	server: object;
	containers: {
		refreshRate: number;
		services: {
			include: string[];
			exclude: string[];
		};
	};
};

const isMonitoringWildcard = (service: string) =>
	service === "" || service === "*";

const matchesMonitoringService = (serviceName: string, pattern: string) =>
	isMonitoringWildcard(pattern) || serviceName.includes(pattern);

/**
 * Make the service selected from its Monitoring tab collectable without
 * discarding the server's other monitoring choices. This also repairs the
 * contradictory "include all, exclude all" configuration by limiting the
 * collector to the explicitly repaired service.
 */
export const includeServiceInMetricsConfig = <T extends MetricsConfig>(
	metricsConfig: T,
	serviceName: string,
): T => {
	const include = [...metricsConfig.containers.services.include];
	const exclude = [...metricsConfig.containers.services.exclude];
	const includesAll =
		include.length === 0 || include.some(isMonitoringWildcard);
	const excludesAll = exclude.some(isMonitoringWildcard);

	const nextInclude =
		includesAll && excludesAll
			? [serviceName]
			: includesAll ||
					include.some((pattern) =>
						matchesMonitoringService(serviceName, pattern),
					)
				? include
				: [...include, serviceName];
	const nextExclude = exclude.filter(
		(pattern) => !matchesMonitoringService(serviceName, pattern),
	);

	return {
		...metricsConfig,
		containers: {
			...metricsConfig.containers,
			services: {
				include: nextInclude,
				exclude: nextExclude,
			},
		},
	} as T;
};

export type ServiceMonitoringState = "collected" | "excluded" | "missing";

export const getServiceMonitoringState = (
	metricsConfig: MetricsConfig | null | undefined,
	serviceName: string,
): ServiceMonitoringState => {
	const services = metricsConfig?.containers?.services;
	const include = services?.include ?? [];
	const exclude = services?.exclude ?? [];
	if (
		exclude.some((pattern) => matchesMonitoringService(serviceName, pattern))
	) {
		return "excluded";
	}
	if (
		include.length === 0 ||
		include.some((pattern) => matchesMonitoringService(serviceName, pattern))
	) {
		return "collected";
	}
	return "missing";
};

export type EnsureServiceMonitoringResult =
	| ServiceMonitoringState
	| "included"
	| "configured"
	| "skipped"
	| "error";

/**
 * Deploy-time hook that keeps per-service monitoring in sync: provisions the
 * agent on remote servers that never got one and re-adds services that a
 * narrowed include list would silently drop. Explicit excludes are an
 * administrator's choice and are respected, and failures only warn because
 * monitoring must never break a deployment.
 */
export const ensureServiceMonitoring = async (
	appName: string,
	serverId?: string | null,
	log?: (message: string) => void,
): Promise<EnsureServiceMonitoringResult> => {
	try {
		if (!serverId) {
			if (IS_CLOUD) return "skipped";
			const settings = await getWebServerSettings();
			const metricsConfig = settings?.metricsConfig;
			// Local monitoring stays opt-in; only fix the filters once enabled.
			if (!metricsConfig?.server?.token) return "skipped";
			const state = getServiceMonitoringState(metricsConfig, appName);
			if (state !== "missing") return state;
			log?.(`Adding "${appName}" to the monitoring configuration...`);
			await updateWebServerSettings({
				metricsConfig: includeServiceInMetricsConfig(metricsConfig, appName),
			});
			await setupWebMonitoring();
			return "included";
		}

		const server = await findServerById(serverId);
		if (server.serverType !== "deploy") return "skipped";
		if (!server.metricsConfig?.server?.token) {
			log?.("Monitoring is not configured on this server. Setting it up...");
			await autoConfigureMonitoring(serverId, appName);
			return "configured";
		}
		const state = getServiceMonitoringState(server.metricsConfig, appName);
		if (state !== "missing") return state;
		log?.(`Adding "${appName}" to the monitoring configuration...`);
		await updateServerById(serverId, {
			metricsConfig: includeServiceInMetricsConfig(
				server.metricsConfig,
				appName,
			),
		});
		await setupMonitoring(serverId);
		return "included";
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`Monitoring auto-configuration for "${appName}" failed: ${message}`,
		);
		log?.(
			`Monitoring auto-configuration failed (the deployment is not affected): ${message}`,
		);
		return "error";
	}
};

const encodeWildcardForLegacyAgent = (services: string[]) =>
	services.map((service) => (service === "*" ? "" : service));

// Older published monitoring images stop collecting when `include` is empty,
// even though their filter treats an empty list as "all services". An empty
// string is a substring of every container name, so it safely carries the
// intended wildcard semantics to both old and corrected monitoring agents.
export const prepareMetricsConfigForAgent = (metricsConfig: MetricsConfig) => ({
	...metricsConfig,
	containers: {
		...metricsConfig.containers,
		services: {
			include:
				metricsConfig.containers.services.include.length === 0
					? [""]
					: encodeWildcardForLegacyAgent(
							metricsConfig.containers.services.include,
						),
			exclude: encodeWildcardForLegacyAgent(
				metricsConfig.containers.services.exclude,
			),
		},
	},
});

// Provisions monitoring with sensible defaults so a remote server starts
// reporting metrics without filling the setup form. An existing token is
// preserved so re-running server setup doesn't invalidate a working agent.
export const autoConfigureMonitoring = async (
	serverId: string,
	serviceName?: string,
) => {
	const server = await findServerById(serverId);
	const baseUrl = await getDokployUrl();
	const token = server.metricsConfig?.server?.token || generateMetricsToken();
	const metricsConfig = serviceName
		? includeServiceInMetricsConfig(server.metricsConfig, serviceName)
		: server.metricsConfig;

	await updateServerById(serverId, {
		metricsConfig: {
			server: {
				...metricsConfig.server,
				token,
				urlCallback: `${baseUrl}/api/trpc/notification.receiveNotification`,
				cronJob: metricsConfig.server.cronJob || "0 0 * * *",
			},
			containers: metricsConfig.containers,
		},
	});

	await setupMonitoring(serverId);
};

export const setupMonitoring = async (serverId: string) => {
	const server = await findServerById(serverId);
	const metricsConfig = prepareMetricsConfigForAgent(server.metricsConfig);

	const serviceName = "dokploy-monitoring";
	const imageName = getMonitoringImage();

	const settings: CreateServiceOptions = {
		Name: serviceName,
		TaskTemplate: {
			ContainerSpec: {
				Image: imageName,
				Env: [`METRICS_CONFIG=${JSON.stringify(metricsConfig)}`],
				Mounts: [
					{
						Type: "bind",
						Source: "/var/run/docker.sock",
						Target: "/var/run/docker.sock",
						ReadOnly: true,
					},
					{
						Type: "bind",
						Source: "/sys",
						Target: "/host/sys",
						ReadOnly: true,
					},
					{
						Type: "bind",
						Source: "/etc/os-release",
						Target: "/etc/os-release",
						ReadOnly: true,
					},
					{
						Type: "bind",
						Source: "/proc",
						Target: "/host/proc",
						ReadOnly: true,
					},
					{
						Type: "bind",
						Source: "/etc/dokploy/monitoring/monitoring.db",
						Target: "/app/monitoring.db",
					},
				],
			},
			Networks: [{ Target: "host" }],
			Placement: {
				Constraints: ["node.role==manager"],
			},
		},
		Mode: {
			Replicated: {
				Replicas: 1,
			},
		},
	};

	const docker = await getRemoteDocker(serverId);

	await execAsyncRemote(
		serverId,
		"mkdir -p /etc/dokploy/monitoring && touch /etc/dokploy/monitoring/monitoring.db",
	);
	await pullRemoteImage(imageName, serverId);
	await deployMonitoringService(docker, serviceName, settings);
};

export const setupWebMonitoring = async () => {
	const webServerSettings = await getWebServerSettings();

	const serviceName = "dokploy-monitoring";
	const imageName = getMonitoringImage();
	const port = webServerSettings?.metricsConfig?.server?.port;
	// Without a token + callback the agent exits fatally on boot, so a deploy
	// here would only produce a crash-looping service.
	if (!webServerSettings?.metricsConfig?.server?.token || !port) {
		throw new Error(
			"Monitoring is not configured yet. Save the monitoring settings first.",
		);
	}
	const metricsConfig = prepareMetricsConfigForAgent(
		webServerSettings.metricsConfig,
	);

	const settings: CreateServiceOptions = {
		Name: serviceName,
		TaskTemplate: {
			ContainerSpec: {
				Image: imageName,
				Env: [`METRICS_CONFIG=${JSON.stringify(metricsConfig)}`],
				Mounts: [
					{
						Type: "bind",
						Source: "/var/run/docker.sock",
						Target: "/var/run/docker.sock",
						ReadOnly: true,
					},
					{
						Type: "bind",
						Source: "/sys",
						Target: "/host/sys",
						ReadOnly: true,
					},
					{
						Type: "bind",
						Source: "/etc/os-release",
						Target: "/etc/os-release",
						ReadOnly: true,
					},
					{
						Type: "bind",
						Source: "/proc",
						Target: "/host/proc",
						ReadOnly: true,
					},
					{
						Type: "bind",
						Source: "/etc/dokploy/monitoring/monitoring.db",
						Target: "/app/monitoring.db",
					},
				],
			},
			Placement: {
				Constraints: ["node.role==manager"],
			},
		},
		Mode: {
			Replicated: {
				Replicas: 1,
			},
		},
		EndpointSpec: {
			Ports: [
				{
					TargetPort: port,
					PublishedPort: port,
					Protocol: "tcp",
					PublishMode: "host",
				},
			],
		},
	};

	const docker = await getRemoteDocker();

	await execAsync(
		"mkdir -p /etc/dokploy/monitoring && touch /etc/dokploy/monitoring/monitoring.db",
	);
	await pullImage(imageName);
	await deployMonitoringService(docker, serviceName, settings);
};
