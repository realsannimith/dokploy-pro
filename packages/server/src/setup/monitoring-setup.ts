import { getDokployUrl } from "@dokploy/server/services/admin";
import {
	findServerById,
	updateServerById,
} from "@dokploy/server/services/server";
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings";
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
	server: unknown;
	containers: {
		refreshRate: number;
		services: {
			include: string[];
			exclude: string[];
		};
	};
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
export const autoConfigureMonitoring = async (serverId: string) => {
	const server = await findServerById(serverId);
	const baseUrl = await getDokployUrl();
	const token = server.metricsConfig?.server?.token || generateMetricsToken();

	await updateServerById(serverId, {
		metricsConfig: {
			server: {
				...server.metricsConfig.server,
				token,
				urlCallback: `${baseUrl}/api/trpc/notification.receiveNotification`,
				cronJob: server.metricsConfig.server.cronJob || "0 0 * * *",
			},
			containers: server.metricsConfig.containers,
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
	const metricsConfig = webServerSettings?.metricsConfig
		? prepareMetricsConfigForAgent(webServerSettings.metricsConfig)
		: undefined;

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
