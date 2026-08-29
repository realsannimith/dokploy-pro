import { randomBytes } from "node:crypto";
import type { AgentToolConfig } from "@dokploy/server/db/schema/agent";
import { generateAppName } from "@dokploy/server/db/schema/utils";
import { type Tool, tool } from "ai";
import { z } from "zod";
import type { AgentCaller } from "./caller";

export type AgentToolGroup = "Read" | "Operate" | "Create" | "Destructive";

export interface AgentToolMeta {
	name: string;
	group: AgentToolGroup;
	description: string;
	/** Destructive tools always require confirmation; it cannot be disabled. */
	destructive?: boolean;
	summarize?: (input: any) => string;
}

export const AGENT_TOOL_META: AgentToolMeta[] = [
	{
		name: "listProjects",
		group: "Read",
		description: "List projects, environments and services",
	},
	{
		name: "getService",
		group: "Read",
		description: "Read one service's details, domains and backups",
	},
	{
		name: "listDeployments",
		group: "Read",
		description: "List recent deployments",
	},
	{
		name: "readDeploymentLogs",
		group: "Read",
		description: "Read deployment logs",
	},
	{ name: "listSchedules", group: "Read", description: "List cron schedules" },
	{
		name: "listBackupFiles",
		group: "Read",
		description: "List stored backup files",
	},
	{ name: "listServers", group: "Read", description: "List remote servers" },
	{
		name: "listContainers",
		group: "Read",
		description: "List docker containers",
	},
	{
		name: "deployService",
		group: "Operate",
		description: "Deploy a service",
		summarize: (input) => `Deploy ${input.serviceType} ${input.serviceId}`,
	},
	{
		name: "redeployService",
		group: "Operate",
		description: "Redeploy from the last build",
		summarize: (input) => `Redeploy ${input.serviceType} ${input.serviceId}`,
	},
	{
		name: "startService",
		group: "Operate",
		description: "Start a stopped service",
		summarize: (input) => `Start ${input.serviceType} ${input.serviceId}`,
	},
	{
		name: "stopService",
		group: "Operate",
		description: "Stop a running service",
		summarize: (input) => `Stop ${input.serviceType} ${input.serviceId}`,
	},
	{
		name: "runSchedule",
		group: "Operate",
		description: "Run a cron schedule manually",
	},
	{
		name: "runBackup",
		group: "Operate",
		description: "Run a database backup manually",
	},
	{
		name: "createProject",
		group: "Create",
		description: "Create a project",
		summarize: (input) => `Create project "${input.name}"`,
	},
	{
		name: "createEnvironment",
		group: "Create",
		description: "Create an environment in a project",
		summarize: (input) => `Create environment "${input.name}"`,
	},
	{
		name: "createDatabase",
		group: "Create",
		description: "Create a database service",
		summarize: (input) =>
			`Create ${input.databaseType} database "${input.name}"`,
	},
	{
		name: "createApplication",
		group: "Create",
		description: "Create an application service",
		summarize: (input) => `Create application "${input.name}"`,
	},
	{
		name: "deleteService",
		group: "Destructive",
		description: "Delete a service and its container",
		destructive: true,
		summarize: (input) => `Delete ${input.serviceType} "${input.confirmName}"`,
	},
	{
		name: "deleteEnvironment",
		group: "Destructive",
		description: "Delete an environment and every service in it",
		destructive: true,
		summarize: (input) =>
			`Delete environment "${input.confirmName}" and ALL its services`,
	},
	{
		name: "deleteProject",
		group: "Destructive",
		description: "Delete a whole project and everything in it",
		destructive: true,
		summarize: (input) =>
			`Delete project "${input.confirmName}" and ALL its environments and services`,
	},
];

const AGENT_TOOL_META_MAP = new Map(
	AGENT_TOOL_META.map((meta) => [meta.name, meta]),
);

export interface ResolvedToolSetting {
	enabled: boolean;
	confirm: boolean;
}

/** Missing config entries fall back to: enabled, confirm only for destructive. */
export const resolveToolSetting = (
	name: string,
	config?: AgentToolConfig | null,
): ResolvedToolSetting => {
	const meta = AGENT_TOOL_META_MAP.get(name);
	const setting = config?.[name];
	const destructive = !!meta?.destructive;
	return {
		enabled: setting?.enabled ?? true,
		confirm: destructive ? true : (setting?.confirm ?? false),
	};
};

const summarizeToolCall = (name: string, input: unknown) => {
	const meta = AGENT_TOOL_META_MAP.get(name);
	if (meta?.summarize) {
		try {
			return meta.summarize(input);
		} catch {
			// fall through to the generic summary
		}
	}
	const raw = JSON.stringify(input ?? {});
	return `${name} ${raw.length > 200 ? `${raw.slice(0, 200)}…` : raw}`;
};

export interface AgentConfirmationHandler {
	request: (request: {
		toolName: string;
		summary: string;
		toolInput: unknown;
	}) => Promise<string>;
}

export interface BuildAgentToolsOptions {
	toolConfig?: AgentToolConfig | null;
	/**
	 * When set, tools whose resolved setting requires confirmation do not
	 * execute; they hand the call to this handler (which stores it and shows
	 * Approve/Reject buttons) and return its marker text to the model.
	 */
	confirmation?: AgentConfirmationHandler;
}

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

const databaseTypeSchema = z.enum([
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
	"libsql",
]);

type DatabaseType = z.infer<typeof databaseTypeSchema>;

const DEFAULT_DB_IMAGES: Record<DatabaseType, string> = {
	postgres: "postgres:18",
	mysql: "mysql:8",
	mariadb: "mariadb:11",
	mongo: "mongo:8",
	redis: "redis:8",
	libsql: "ghcr.io/tursodatabase/libsql-server:v0.24.32",
};

const DEFAULT_DB_USERS: Record<Exclude<DatabaseType, "redis">, string> = {
	postgres: "postgres",
	mysql: "mysql",
	mariadb: "mariadb",
	mongo: "mongo",
	libsql: "libsql",
};

// Alphanumeric only, so it always satisfies DATABASE_PASSWORD_REGEX.
const PASSWORD_CHARS =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const generatePassword = (length = 24) => {
	const bytes = randomBytes(length);
	let result = "";
	for (const byte of bytes) {
		result += PASSWORD_CHARS[byte % PASSWORD_CHARS.length];
	}
	return result;
};

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

export const buildAgentTools = (
	caller: AgentCaller,
	options?: BuildAgentToolsOptions,
) => {
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

	const allTools = {
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
		createProject: tool({
			description:
				"Create a new project. A default 'production' environment is created with it; the response includes its environmentId so services can be added right away.",
			inputSchema: z.object({
				name: z.string().min(1),
				description: z.string().optional(),
			}),
			execute: async ({ name, description }) => {
				try {
					const result = (await caller.project.create({
						name,
						description,
					})) as any;
					return toResult({
						project: pick(result?.project, ["projectId", "name"]),
						environment: pick(result?.environment, ["environmentId", "name"]),
					});
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		createEnvironment: tool({
			description:
				"Create a new environment inside an existing project (e.g. staging, development).",
			inputSchema: z.object({
				projectId: z.string(),
				name: z.string().min(1),
				description: z.string().optional(),
			}),
			execute: async ({ projectId, name, description }) => {
				try {
					const environment = (await caller.environment.create({
						projectId,
						name,
						description,
					})) as any;
					return toResult(pick(environment, ["environmentId", "name"]));
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		createDatabase: tool({
			description:
				"Create a new database service (postgres, mysql, mariadb, mongo, redis or libsql) in an environment. Credentials are auto-generated when omitted and returned once — share them with the user. The database is created but NOT started; call deployService with the returned serviceId to actually start it.",
			inputSchema: z.object({
				environmentId: z
					.string()
					.describe("Get it from listProjects or createProject"),
				databaseType: databaseTypeSchema,
				name: z.string().min(1).describe("Display name for the service"),
				serverId: z
					.string()
					.optional()
					.describe(
						"Deploy on this remote server (see listServers). Omit to run on the Dokploy host.",
					),
				databaseName: z.string().optional(),
				databaseUser: z.string().optional(),
				databasePassword: z
					.string()
					.optional()
					.describe("Omit to auto-generate a secure password"),
				dockerImage: z.string().optional(),
				description: z.string().optional(),
			}),
			execute: async (input) => {
				try {
					const { databaseType, environmentId, name } = input;
					const appName = generateAppName(databaseType);
					const dockerImage =
						input.dockerImage || DEFAULT_DB_IMAGES[databaseType];
					const databasePassword = input.databasePassword || generatePassword();
					const databaseUser =
						databaseType === "redis"
							? undefined
							: input.databaseUser || DEFAULT_DB_USERS[databaseType];
					const databaseName =
						input.databaseName ||
						(databaseType === "postgres"
							? "postgres"
							: databaseType === "mysql"
								? "mysql"
								: "mariadb");
					const common = {
						name,
						appName,
						dockerImage,
						environmentId,
						description: input.description ?? "",
						serverId: input.serverId || null,
					};

					let created: any;
					let rootPassword: string | undefined;
					switch (databaseType) {
						case "postgres":
							created = await caller.postgres.create({
								...common,
								databaseName,
								databaseUser: databaseUser as string,
								databasePassword,
							} as any);
							break;
						case "mysql":
							rootPassword = generatePassword();
							created = await caller.mysql.create({
								...common,
								databaseName,
								databaseUser: databaseUser as string,
								databasePassword,
								databaseRootPassword: rootPassword,
							} as any);
							break;
						case "mariadb":
							rootPassword = generatePassword();
							created = await caller.mariadb.create({
								...common,
								databaseName,
								databaseUser: databaseUser as string,
								databasePassword,
								databaseRootPassword: rootPassword,
							} as any);
							break;
						case "mongo":
							created = await caller.mongo.create({
								...common,
								databaseUser: databaseUser as string,
								databasePassword,
								replicaSets: false,
							} as any);
							break;
						case "redis":
							created = await caller.redis.create({
								...common,
								databasePassword,
							} as any);
							break;
						case "libsql":
							created = await caller.libsql.create({
								...common,
								databaseUser: databaseUser as string,
								databasePassword,
								sqldNode: "primary",
								sqldPrimaryUrl: null,
								enableNamespaces: false,
							} as any);
							break;
					}

					const serviceId =
						created && typeof created === "object"
							? created[serviceIdField[databaseType]]
							: undefined;
					return toResult({
						serviceType: databaseType,
						serviceId: serviceId ?? "(created — find the id with listProjects)",
						name,
						appName,
						credentials: {
							...(databaseUser ? { user: databaseUser } : {}),
							password: databasePassword,
							...(databaseType === "postgres" ||
							databaseType === "mysql" ||
							databaseType === "mariadb"
								? { database: databaseName }
								: {}),
							...(rootPassword ? { rootPassword } : {}),
						},
						deployed: false,
						next: "Call deployService with this serviceType/serviceId to start the database.",
					});
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		createApplication: tool({
			description:
				"Create a new (empty) application service in an environment. The git/docker source must then be configured in the dashboard before it can deploy.",
			inputSchema: z.object({
				environmentId: z.string(),
				name: z.string().min(1),
				serverId: z
					.string()
					.optional()
					.describe(
						"Deploy on this remote server (see listServers). Omit to run on the Dokploy host.",
					),
				description: z.string().optional(),
			}),
			execute: async ({ environmentId, name, serverId, description }) => {
				try {
					const created = (await caller.application.create({
						name,
						appName: generateAppName("app"),
						environmentId,
						serverId: serverId || null,
						description: description ?? "",
					} as any)) as any;
					return toResult({
						serviceType: "application",
						serviceId: created?.applicationId,
						...pick(created, ["name", "appName"]),
						next: "Configure its source (git provider or docker image) in the dashboard, then deploy.",
					});
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		deleteService: tool({
			description:
				"Permanently delete a service and its container. DESTRUCTIVE and irreversible — only call this after the user explicitly confirmed the deletion in this conversation. confirmName must exactly match the service's current name (check with getService).",
			inputSchema: z.object({
				serviceType: serviceTypeSchema,
				serviceId: z.string(),
				confirmName: z
					.string()
					.describe("The exact name of the service, as a safety check"),
				deleteVolumes: z
					.boolean()
					.default(false)
					.describe("Compose only: also delete its volumes"),
			}),
			execute: async ({
				serviceType,
				serviceId,
				confirmName,
				deleteVolumes,
			}) => {
				try {
					const service = (await getService(serviceType, serviceId)) as any;
					if (service?.name !== confirmName) {
						return toResult(
							`Refused: confirmName "${confirmName}" does not match the service's actual name "${service?.name}". Double-check with the user before deleting.`,
						);
					}
					switch (serviceType) {
						case "application":
							await caller.application.delete({ applicationId: serviceId });
							break;
						case "compose":
							await caller.compose.delete({
								composeId: serviceId,
								deleteVolumes,
							});
							break;
						case "postgres":
							await caller.postgres.remove({ postgresId: serviceId });
							break;
						case "mysql":
							await caller.mysql.remove({ mysqlId: serviceId });
							break;
						case "mariadb":
							await caller.mariadb.remove({ mariadbId: serviceId });
							break;
						case "mongo":
							await caller.mongo.remove({ mongoId: serviceId });
							break;
						case "redis":
							await caller.redis.remove({ redisId: serviceId });
							break;
						case "libsql":
							await caller.libsql.remove({ libsqlId: serviceId });
							break;
					}
					return toResult(`Service "${confirmName}" deleted.`);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		deleteEnvironment: tool({
			description:
				"Permanently delete an environment and EVERY service inside it. DESTRUCTIVE and irreversible — only call this after the user explicitly confirmed. confirmName must exactly match the environment's name.",
			inputSchema: z.object({
				environmentId: z.string(),
				confirmName: z
					.string()
					.describe("The exact name of the environment, as a safety check"),
			}),
			execute: async ({ environmentId, confirmName }) => {
				try {
					const environment = (await caller.environment.one({
						environmentId,
					})) as any;
					if (environment?.name !== confirmName) {
						return toResult(
							`Refused: confirmName "${confirmName}" does not match the environment's actual name "${environment?.name}".`,
						);
					}
					await caller.environment.remove({ environmentId });
					return toResult(`Environment "${confirmName}" deleted.`);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		deleteProject: tool({
			description:
				"Permanently delete a whole project with ALL its environments and services. DESTRUCTIVE and irreversible — only call this after the user explicitly confirmed. confirmName must exactly match the project's name.",
			inputSchema: z.object({
				projectId: z.string(),
				confirmName: z
					.string()
					.describe("The exact name of the project, as a safety check"),
			}),
			execute: async ({ projectId, confirmName }) => {
				try {
					const project = (await caller.project.one({ projectId })) as any;
					if (project?.name !== confirmName) {
						return toResult(
							`Refused: confirmName "${confirmName}" does not match the project's actual name "${project?.name}".`,
						);
					}
					await caller.project.remove({ projectId });
					return toResult(`Project "${confirmName}" deleted.`);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
	};

	const tools: Record<string, Tool> = {};
	for (const [name, toolDef] of Object.entries(
		allTools as Record<string, Tool>,
	)) {
		const setting = resolveToolSetting(name, options?.toolConfig);
		if (!setting.enabled) continue;
		const confirmation = options?.confirmation;
		if (setting.confirm && confirmation) {
			tools[name] = {
				...toolDef,
				execute: async (input: unknown) =>
					await confirmation.request({
						toolName: name,
						summary: summarizeToolCall(name, input),
						toolInput: input,
					}),
			};
		} else {
			tools[name] = toolDef;
		}
	}
	return tools;
};
