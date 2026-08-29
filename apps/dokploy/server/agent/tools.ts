import { tool } from "ai";
import { z } from "zod";
import type { AgentCaller } from "./caller";

const serviceTypeSchema = z.enum([
	"application",
	"compose",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
	"libsql",
]);

type ServiceType = z.infer<typeof serviceTypeSchema>;

const MAX_OUTPUT_CHARS = 8000;

const toResult = (value: unknown) => {
	const text =
		typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
	if (text.length > MAX_OUTPUT_CHARS) {
		return `${text.slice(0, MAX_OUTPUT_CHARS)}\n... (output truncated)`;
	}
	return text;
};

const toErrorResult = (error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	return `Error: ${message}`;
};

const pick = (obj: unknown, keys: string[]): Record<string, unknown> => {
	if (!obj || typeof obj !== "object") return {};
	const record = obj as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		if (record[key] !== undefined) result[key] = record[key];
	}
	return result;
};

const serviceIdField: Record<ServiceType, string> = {
	application: "applicationId",
	compose: "composeId",
	postgres: "postgresId",
	mysql: "mysqlId",
	mariadb: "mariadbId",
	mongo: "mongoId",
	redis: "redisId",
	libsql: "libsqlId",
};

const summarizeServices = (environment: Record<string, any>) => {
	const services: Array<Record<string, unknown>> = [];
	for (const type of serviceTypeSchema.options) {
		const key = type === "application" ? "applications" : type;
		for (const service of environment[key] ?? []) {
			services.push({
				serviceType: type,
				serviceId: service[serviceIdField[type]],
				name: service.name,
				status: service.applicationStatus ?? service.composeStatus,
			});
		}
	}
	return services;
};

const backupSummaryKeys = [
	"backupId",
	"schedule",
	"enabled",
	"prefix",
	"database",
	"databaseType",
	"backupType",
	"keepLatestCount",
];

const deploymentSummaryKeys = [
	"deploymentId",
	"status",
	"title",
	"description",
	"createdAt",
	"startedAt",
	"finishedAt",
	"errorMessage",
];

const scheduleSummaryKeys = [
	"scheduleId",
	"name",
	"cronExpression",
	"scheduleType",
	"command",
	"enabled",
	"timezone",
	"applicationId",
	"composeId",
	"serverId",
];

export const buildAgentTools = (caller: AgentCaller) => {
	const getService = async (serviceType: ServiceType, serviceId: string) => {
		switch (serviceType) {
			case "application":
				return await caller.application.one({ applicationId: serviceId });
			case "compose":
				return await caller.compose.one({ composeId: serviceId });
			case "postgres":
				return await caller.postgres.one({ postgresId: serviceId });
			case "mysql":
				return await caller.mysql.one({ mysqlId: serviceId });
			case "mariadb":
				return await caller.mariadb.one({ mariadbId: serviceId });
			case "mongo":
				return await caller.mongo.one({ mongoId: serviceId });
			case "redis":
				return await caller.redis.one({ redisId: serviceId });
			case "libsql":
				return await caller.libsql.one({ libsqlId: serviceId });
		}
	};

	return {
		listProjects: tool({
			description:
				"List every project with its environments and services (name, id, type, status). Use this first to find the service the user is talking about.",
			inputSchema: z.object({}),
			execute: async () => {
				try {
					const projects = await caller.project.all();
					return toResult(
						projects.map((project: any) => ({
							projectId: project.projectId,
							name: project.name,
							description: project.description,
							environments: (project.environments ?? []).map((env: any) => ({
								environmentId: env.environmentId,
								name: env.name,
								services: summarizeServices(env),
							})),
						})),
					);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		getService: tool({
			description:
				"Get details for one service: status, app name, server, domains, configured backups and their cron schedules. Environment variables are intentionally not included.",
			inputSchema: z.object({
				serviceType: serviceTypeSchema,
				serviceId: z
					.string()
					.describe("The id of the service, e.g. applicationId or postgresId"),
			}),
			execute: async ({ serviceType, serviceId }) => {
				try {
					const service = (await getService(serviceType, serviceId)) as any;
					return toResult({
						...pick(service, [
							"name",
							"appName",
							"description",
							"applicationStatus",
							"composeStatus",
							"serverId",
							"createdAt",
							"sourceType",
							"composeType",
						]),
						serviceType,
						serviceId,
						domains: (service.domains ?? []).map((domain: any) =>
							pick(domain, ["host", "port", "https", "path", "serviceName"]),
						),
						backups: (service.backups ?? []).map((backup: any) =>
							pick(backup, backupSummaryKeys),
						),
						server: service.server ? pick(service.server, ["name"]) : null,
					});
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		deployService: tool({
			description:
				"Trigger a deployment for a service. For applications/compose this queues a build+deploy (visible in the dashboard's deployments tab). For databases this (re)creates the container.",
			inputSchema: z.object({
				serviceType: serviceTypeSchema,
				serviceId: z.string(),
			}),
			execute: async ({ serviceType, serviceId }) => {
				try {
					switch (serviceType) {
						case "application":
							await caller.application.deploy({
								applicationId: serviceId,
								title: "Deployment via AI agent",
							} as any);
							break;
						case "compose":
							await caller.compose.deploy({ composeId: serviceId } as any);
							break;
						case "postgres":
							await caller.postgres.deploy({ postgresId: serviceId });
							break;
						case "mysql":
							await caller.mysql.deploy({ mysqlId: serviceId });
							break;
						case "mariadb":
							await caller.mariadb.deploy({ mariadbId: serviceId });
							break;
						case "mongo":
							await caller.mongo.deploy({ mongoId: serviceId });
							break;
						case "redis":
							await caller.redis.deploy({ redisId: serviceId });
							break;
						case "libsql":
							await caller.libsql.deploy({ libsqlId: serviceId });
							break;
					}
					return toResult(
						"Deployment queued. Use listDeployments to check its status.",
					);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		redeployService: tool({
			description:
				"Redeploy an application or compose service using the last build (no git refetch).",
			inputSchema: z.object({
				serviceType: z.enum(["application", "compose"]),
				serviceId: z.string(),
			}),
			execute: async ({ serviceType, serviceId }) => {
				try {
					if (serviceType === "application") {
						await caller.application.redeploy({
							applicationId: serviceId,
						} as any);
					} else {
						await caller.compose.redeploy({ composeId: serviceId } as any);
					}
					return toResult("Redeploy queued.");
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		startService: tool({
			description: "Start a stopped service.",
			inputSchema: z.object({
				serviceType: serviceTypeSchema,
				serviceId: z.string(),
			}),
			execute: async ({ serviceType, serviceId }) => {
				try {
					switch (serviceType) {
						case "application":
							await caller.application.start({ applicationId: serviceId });
							break;
						case "compose":
							await caller.compose.start({ composeId: serviceId });
							break;
						case "postgres":
							await caller.postgres.start({ postgresId: serviceId });
							break;
						case "mysql":
							await caller.mysql.start({ mysqlId: serviceId });
							break;
						case "mariadb":
							await caller.mariadb.start({ mariadbId: serviceId });
							break;
						case "mongo":
							await caller.mongo.start({ mongoId: serviceId });
							break;
						case "redis":
							await caller.redis.start({ redisId: serviceId });
							break;
						case "libsql":
							await caller.libsql.start({ libsqlId: serviceId });
							break;
					}
					return toResult("Service started.");
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		stopService: tool({
			description:
				"Stop a running service. Ask the user for confirmation before stopping anything that looks production-critical.",
			inputSchema: z.object({
				serviceType: serviceTypeSchema,
				serviceId: z.string(),
			}),
			execute: async ({ serviceType, serviceId }) => {
				try {
					switch (serviceType) {
						case "application":
							await caller.application.stop({ applicationId: serviceId });
							break;
						case "compose":
							await caller.compose.stop({ composeId: serviceId });
							break;
						case "postgres":
							await caller.postgres.stop({ postgresId: serviceId });
							break;
						case "mysql":
							await caller.mysql.stop({ mysqlId: serviceId });
							break;
						case "mariadb":
							await caller.mariadb.stop({ mariadbId: serviceId });
							break;
						case "mongo":
							await caller.mongo.stop({ mongoId: serviceId });
							break;
						case "redis":
							await caller.redis.stop({ redisId: serviceId });
							break;
						case "libsql":
							await caller.libsql.stop({ libsqlId: serviceId });
							break;
					}
					return toResult("Service stopped.");
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		listDeployments: tool({
			description:
				"List recent deployments for an application, compose service or schedule (most recent first).",
			inputSchema: z.object({
				type: z.enum(["application", "compose", "schedule"]),
				id: z
					.string()
					.describe(
						"applicationId, composeId or scheduleId to list deployments for",
					),
				limit: z.number().int().min(1).max(50).default(10),
			}),
			execute: async ({ type, id, limit }) => {
				try {
					const deployments = await caller.deployment.allByType({ type, id });
					return toResult(
						deployments
							.slice(0, limit)
							.map((deployment: any) =>
								pick(deployment, deploymentSummaryKeys),
							),
					);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		readDeploymentLogs: tool({
			description:
				"Read the tail of a deployment's build/run log. Useful to diagnose failed deployments.",
			inputSchema: z.object({
				deploymentId: z.string(),
				tail: z.number().int().min(1).max(2000).default(100),
			}),
			execute: async ({ deploymentId, tail }) => {
				try {
					const logs = await caller.deployment.readLogs({ deploymentId, tail });
					return toResult(logs || "(log is empty)");
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		listSchedules: tool({
			description:
				"List cron task schedules. Use scheduleType 'application'/'compose' with the service id, 'server' with a serverId, or 'dokploy-server' for schedules that run on the Dokploy host itself.",
			inputSchema: z.object({
				scheduleType: z.enum([
					"application",
					"compose",
					"server",
					"dokploy-server",
				]),
				id: z
					.string()
					.default("dokploy-server")
					.describe(
						"The service or server id. Ignored for scheduleType 'dokploy-server'.",
					),
			}),
			execute: async ({ scheduleType, id }) => {
				try {
					const schedules = await caller.schedule.list({ scheduleType, id });
					return toResult(
						(schedules as any[]).map((schedule) =>
							pick(schedule, scheduleSummaryKeys),
						),
					);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		runSchedule: tool({
			description: "Run a schedule (cron task) manually right now.",
			inputSchema: z.object({
				scheduleId: z.string(),
			}),
			execute: async ({ scheduleId }) => {
				try {
					const result = await caller.schedule.runManually({ scheduleId });
					return toResult(result);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		runBackup: tool({
			description:
				"Run a database backup manually right now. Get the backupId from getService first.",
			inputSchema: z.object({
				backupId: z.string(),
			}),
			execute: async ({ backupId }) => {
				try {
					const backup = (await caller.backup.one({ backupId })) as any;
					switch (backup.databaseType) {
						case "postgres":
							await caller.backup.manualBackupPostgres({ backupId });
							break;
						case "mysql":
							await caller.backup.manualBackupMySql({ backupId });
							break;
						case "mariadb":
							await caller.backup.manualBackupMariadb({ backupId });
							break;
						case "mongo":
							await caller.backup.manualBackupMongo({ backupId });
							break;
						case "libsql":
							await caller.backup.manualBackupLibsql({ backupId });
							break;
						case "web-server":
							await caller.backup.manualBackupWebServer({ backupId });
							break;
						default:
							if (backup.backupType === "compose") {
								await caller.backup.manualBackupCompose({ backupId });
								break;
							}
							return toResult(
								`Unsupported backup type: ${backup.databaseType}`,
							);
					}
					return toResult("Backup started successfully.");
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		listBackupFiles: tool({
			description:
				"List the files stored in a backup destination for a given backup (to verify backups actually exist).",
			inputSchema: z.object({
				backupId: z.string(),
				limit: z.number().int().min(1).max(50).default(10),
			}),
			execute: async ({ backupId, limit }) => {
				try {
					const backup = (await caller.backup.one({ backupId })) as any;
					const files = await caller.backup.listBackupFiles({
						destinationId: backup.destinationId,
						search: backup.prefix || "",
					});
					const list = Array.isArray(files) ? files.slice(0, limit) : files;
					return toResult(list);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		listServers: tool({
			description: "List remote servers connected to this Dokploy instance.",
			inputSchema: z.object({}),
			execute: async () => {
				try {
					const servers = await caller.server.all();
					return toResult(
						(servers as any[]).map((server) =>
							pick(server, [
								"serverId",
								"name",
								"description",
								"ipAddress",
								"port",
								"username",
								"serverStatus",
								"createdAt",
							]),
						),
					);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		listContainers: tool({
			description:
				"List docker containers on the Dokploy host or a remote server.",
			inputSchema: z.object({
				serverId: z
					.string()
					.optional()
					.describe("Omit to list containers on the Dokploy host"),
			}),
			execute: async ({ serverId }) => {
				try {
					const containers = await caller.docker.getContainers({
						serverId: serverId || undefined,
					});
					return toResult(
						(containers ?? []).map((container: any) =>
							pick(container, [
								"containerId",
								"name",
								"image",
								"state",
								"status",
							]),
						),
					);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
	};
};
