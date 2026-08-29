import { randomBytes } from "node:crypto";
import type {
	AgentMcpConfig,
	AgentToolConfig,
} from "@dokploy/server/db/schema/agent";
import {
	agentMemoryKeySchema,
	agentSkillNameSchema,
	apiSaveAgentMemory,
	apiSaveAgentSkill,
} from "@dokploy/server/db/schema/agent";
import {
	deleteAgentMemory,
	findAgentMemories,
	findAgentSkillByName,
	findAgentSkills,
	recordAgentSkillUse,
	saveAgentMemory,
	saveAgentSkill,
} from "@dokploy/server/services/agent";
import { type Tool, tool } from "ai";
import { z } from "zod";
import { slugify } from "@/lib/slug";
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
		name: "inspectServer",
		group: "Read",
		description: "Check remote-server readiness, health, and monitoring",
	},
	{
		name: "listContainers",
		group: "Read",
		description: "List docker containers",
	},
	{
		name: "listSkills",
		group: "Read",
		description: "List reusable skills learned by this agent",
	},
	{
		name: "readSkill",
		group: "Read",
		description: "Load one skill's full instructions when relevant",
	},
	{
		name: "manageSkill",
		group: "Create",
		description: "Create or improve the agent's reusable procedural skills",
		summarize: (input) =>
			`${input.action === "create" ? "Learn" : "Improve"} skill /${input.name}`,
	},
	{
		name: "listMemories",
		group: "Read",
		description: "List durable facts remembered across conversations",
	},
	{
		name: "manageMemory",
		group: "Create",
		description: "Remember or forget one small durable fact",
	},
	{
		name: "searchDokployTools",
		group: "Read",
		description: "Discover any Dokploy API operation allowed by policy",
	},
	{
		name: "callDokployTool",
		group: "Operate",
		description: "Run a discovered Dokploy API operation",
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

const CONFIRMATION_TOOL_NOTE =
	" Calling this does not run it: it sends the user an Approve/Reject prompt in the chat, which is the confirmation step. Call it as soon as the user asks for the action — never ask them to confirm in a chat message first, and never call it again while its prompt is unanswered.";

export interface AgentConfirmationHandler {
	request: (request: {
		toolName: string;
		summary: string;
		toolInput: unknown;
	}) => Promise<string>;
}

export interface BuildAgentToolsOptions {
	agentId: string;
	toolConfig?: AgentToolConfig | null;
	mcpConfig?: AgentMcpConfig | null;
	/**
	 * When set, tools whose resolved setting requires confirmation do not
	 * execute; they hand the call to this handler (which stores it and shows
	 * Approve/Reject buttons) and return its marker text to the model.
	 */
	confirmation?: AgentConfirmationHandler;
	/**
	 * Set only when replaying a tool call the user already approved. The
	 * approval gate has been satisfied, so tools must execute for real
	 * instead of asking for confirmation again (or refusing it).
	 */
	skipConfirmation?: boolean;
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
				deploymentStatus: service.applicationStatus ?? service.composeStatus,
				statusSource: "stored",
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
	options: BuildAgentToolsOptions,
) => {
	const callProcedure = async (procedurePath: string, input: unknown) => {
		let procedure: unknown = caller;
		for (const segment of procedurePath.split(".")) {
			procedure = (procedure as Record<string, unknown>)?.[segment];
		}
		if (typeof procedure !== "function") {
			throw new Error(`Unknown Dokploy procedure: ${procedurePath}`);
		}
		return await (procedure as (args: unknown) => Promise<unknown>)(input);
	};

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

	const deployDatabase = async (
		databaseType: DatabaseType,
		serviceId: string,
	) => {
		switch (databaseType) {
			case "postgres":
				return await caller.postgres.deploy({ postgresId: serviceId });
			case "mysql":
				return await caller.mysql.deploy({ mysqlId: serviceId });
			case "mariadb":
				return await caller.mariadb.deploy({ mariadbId: serviceId });
			case "mongo":
				return await caller.mongo.deploy({ mongoId: serviceId });
			case "redis":
				return await caller.redis.deploy({ redisId: serviceId });
			case "libsql":
				return await caller.libsql.deploy({ libsqlId: serviceId });
		}
	};

	const allTools = {
		searchDokployTools: tool({
			description:
				"Search the complete Dokploy API tool catalog. Use this when the focused built-in tools do not cover an operation. Search first, inspect the returned JSON schema, then call callDokployTool with the exact name and arguments. Results respect the administrator's MCP access policy.",
			inputSchema: z.object({
				query: z.string().trim().default(""),
				router: z.string().trim().optional(),
				type: z.enum(["query", "mutation", "any"]).default("any"),
				limit: z.number().int().min(1).max(20).default(10),
			}),
			execute: async ({ query, router, type, limit }) => {
				try {
					const [{ isMcpToolAllowed, resolveMcpPolicy }, { getMcpTools }] =
						await Promise.all([
							import("@/server/mcp/policy"),
							import("@/server/mcp/registry"),
						]);
					const policy = resolveMcpPolicy(options.mcpConfig);
					const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
					const matches = [...getMcpTools().values()]
						.filter((definition) => isMcpToolAllowed(definition, policy))
						.filter(
							(definition) => !definition.procedurePath.startsWith("agent."),
						)
						.filter(
							(definition) =>
								!router || definition.procedurePath.startsWith(`${router}.`),
						)
						.filter((definition) => type === "any" || definition.type === type)
						.filter((definition) => {
							const haystack =
								`${definition.name} ${definition.procedurePath} ${definition.description}`.toLowerCase();
							return terms.every((term) => haystack.includes(term));
						})
						.slice(0, limit)
						.map((definition) => ({
							name: definition.name,
							procedure: definition.procedurePath,
							type: definition.type,
							description: definition.description,
							inputSchema: definition.inputSchema,
						}));
					return toResult(matches);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		callDokployTool: tool({
			description:
				"Run one exact Dokploy API tool returned by searchDokployTools. Arguments must match its returned inputSchema. Mutations are approval-gated: calling one sends the user an Approve/Reject prompt instead of running it, so never ask the user to confirm in a chat message first. Never guess a tool name or input fields.",
			inputSchema: z.object({
				name: z.string().min(1).max(64),
				arguments: z.record(z.string(), z.unknown()).default({}),
			}),
			execute: async ({ name, arguments: args }) => {
				try {
					const [{ isMcpToolAllowed, resolveMcpPolicy }, { getMcpTools }] =
						await Promise.all([
							import("@/server/mcp/policy"),
							import("@/server/mcp/registry"),
						]);
					const definition = getMcpTools().get(name);
					if (!definition) return toResult(`Unknown Dokploy tool: ${name}`);
					const policy = resolveMcpPolicy(options.mcpConfig);
					if (!isMcpToolAllowed(definition, policy)) {
						return toResult(
							`The tool ${name} is blocked by the administrator's MCP access policy.`,
						);
					}
					if (definition.procedurePath.startsWith("agent.")) {
						return toResult(
							"Refused: the agent cannot call or reconfigure itself through the tool catalog.",
						);
					}
					if (definition.type === "mutation" && !options.skipConfirmation) {
						if (!options.confirmation) {
							return toResult(
								`${definition.procedurePath} is a mutation and requires user approval, which this chat surface cannot collect. Use a focused built-in tool instead, or ask the user to run it from the dashboard or a connected channel.`,
							);
						}
						const shownArgs = JSON.stringify(args);
						return await options.confirmation.request({
							toolName: "callDokployTool",
							summary: `Run Dokploy action ${definition.procedurePath} with ${
								shownArgs.length > 600
									? `${shownArgs.slice(0, 600)}…`
									: shownArgs
							}`,
							toolInput: { name, arguments: args },
						});
					}
					return toResult(await callProcedure(definition.procedurePath, args));
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		listMemories: tool({
			description:
				"List small durable facts remembered across this agent's conversations.",
			inputSchema: z.object({}),
			execute: async () => {
				try {
					const memories = await findAgentMemories(options.agentId);
					return toResult(
						memories.map(({ key, content, origin, updatedAt }) => ({
							key,
							content,
							origin,
							updatedAt,
						})),
					);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		manageMemory: tool({
			description:
				"Remember or forget one small durable fact that should stay available across sessions, such as a naming preference or stable environment convention. Never store passwords, tokens, private keys, API keys, transient statuses, or long procedures (use manageSkill for procedures).",
			inputSchema: z.discriminatedUnion("action", [
				apiSaveAgentMemory.extend({ action: z.literal("remember") }),
				z.object({ action: z.literal("forget"), key: agentMemoryKeySchema }),
			]),
			execute: async (input) => {
				try {
					if (input.action === "forget") {
						const deleted = await deleteAgentMemory(options.agentId, input.key);
						return toResult(
							deleted
								? `Forgot memory ${input.key}.`
								: `Memory ${input.key} was not found.`,
						);
					}
					if (
						/(?:password|secret|api[-_ ]?key|access[-_ ]?token|private[-_ ]?key)\s*[:=]/i.test(
							input.content,
						)
					) {
						return toResult(
							"Refused to store content that looks like a secret.",
						);
					}
					const saved = await saveAgentMemory(
						options.agentId,
						{ key: input.key, content: input.content },
						"agent",
					);
					return toResult(`Remembered ${saved?.key}.`);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		listSkills: tool({
			description:
				"List the names, descriptions and versions of reusable skills learned by this Dokploy agent. Full instructions are intentionally omitted; use readSkill only for a relevant skill.",
			inputSchema: z.object({}),
			execute: async () => {
				try {
					const skills = await findAgentSkills(options.agentId);
					return toResult(
						skills.map(
							({ name, description, version, usageCount, origin }) => ({
								name,
								description,
								version,
								usageCount,
								origin,
							}),
						),
					);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		readSkill: tool({
			description:
				"Load one reusable skill's complete instructions. Call this when a skill from the system prompt index is relevant to the current request.",
			inputSchema: z.object({ name: agentSkillNameSchema }),
			execute: async ({ name }) => {
				try {
					const skill = await findAgentSkillByName(options.agentId, name);
					if (!skill) return toResult(`Skill /${name} was not found.`);
					await recordAgentSkillUse(skill.skillId);
					return toResult({
						name: skill.name,
						description: skill.description,
						version: skill.version,
						content: skill.content,
					});
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		manageSkill: tool({
			description:
				"Create or improve this agent's reusable procedural knowledge after learning a non-trivial, repeatable Dokploy workflow. Use create only for a new skill and update only after readSkill shows the existing skill. Do not save one-off facts, secrets, credentials, raw logs, or unverified guesses. Content must be concise Markdown with When to use, Procedure, Pitfalls, and Verification sections.",
			inputSchema: apiSaveAgentSkill.extend({
				action: z.enum(["create", "update"]),
			}),
			execute: async ({ action, name, description, content }) => {
				try {
					const existing = await findAgentSkillByName(options.agentId, name);
					if (action === "create" && existing) {
						return toResult(
							`Skill /${name} already exists at version ${existing.version}. Read it first, then use action "update".`,
						);
					}
					if (action === "update" && !existing) {
						return toResult(
							`Skill /${name} does not exist. Use action "create" instead.`,
						);
					}
					const saved = await saveAgentSkill(
						options.agentId,
						{ name, description, content },
						"agent",
					);
					return toResult(
						`${action === "create" ? "Created" : "Updated"} /${saved?.name} (version ${saved?.version}).`,
					);
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		listProjects: tool({
			description:
				"List every project with its environments and services (name, id, type and stored deployment status). Use this first to find the service the user is talking about, then call getService for live database runtime state before saying it is working.",
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
				"Get details for one service: current status, app name, server, domains, configured backups and their cron schedules. Database responses include both deploymentStatus (stored lifecycle) and runtime (live Docker truth); only runtime.ready=true proves the database is working. Environment variables are intentionally not included.",
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
							"deploymentStatus",
							"runtime",
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
				"Trigger a deployment for a service. For applications/compose this queues a build+deploy (visible in the dashboard's deployments tab). For databases this requires multiple stable Docker running checks and then returns fresh runtime state.",
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
						case "mysql":
						case "mariadb":
						case "mongo":
						case "redis":
						case "libsql":
							await deployDatabase(serviceType, serviceId);
							break;
					}
					if (serviceType === "application" || serviceType === "compose") {
						return toResult(
							"Deployment queued. Use listDeployments to check its status.",
						);
					}
					const service = (await getService(serviceType, serviceId)) as any;
					return toResult({
						message: service.runtime?.ready
							? "Database deployment verified: its container is stably running."
							: "Deployment finished, but the database is not currently ready.",
						deploymentStatus:
							service.deploymentStatus ?? service.applicationStatus,
						runtime: service.runtime ?? {
							state: "unknown",
							ready: false,
							message: "Live runtime status was not returned",
						},
					});
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
		inspectServer: tool({
			description:
				"Inspect whether a remote server is fully ready for Dokploy. Checks SSH, Docker and Compose, build tools, storage permissions, Swarm/networking, Traefik, monitoring, host health, and the latest metric sample.",
			inputSchema: z.object({
				serverId: z.string().min(1).describe("Get it from listServers"),
			}),
			execute: async ({ serverId }) => {
				try {
					const [validationResult, healthResult, metricsResult] =
						await Promise.allSettled([
							caller.server.validate({ serverId }),
							caller.docker.getServerHealth({ serverId, sinceHours: 24 }),
							caller.server.getServerMetrics({
								serverId,
								dataPoints: "50",
							}),
						]);

					const validation =
						validationResult.status === "fulfilled"
							? validationResult.value
							: { error: toErrorResult(validationResult.reason) };
					const health =
						healthResult.status === "fulfilled"
							? healthResult.value
							: { error: toErrorResult(healthResult.reason) };
					const samples =
						metricsResult.status === "fulfilled" ? metricsResult.value : [];
					const latestMetric = Array.isArray(samples)
						? samples.at(-1)
						: undefined;

					return toResult({
						serverId,
						validation,
						health,
						monitoring:
							metricsResult.status === "fulfilled"
								? { available: true, latestMetric }
								: {
										available: false,
										error: toErrorResult(metricsResult.reason),
									},
					});
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
				"Create and start a new database service (postgres, mysql, mariadb, mongo, redis or libsql) in an environment. Credentials are auto-generated when omitted and returned once — share them with the user. Success is reported only after Docker confirms that its container is running.",
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
					// The service layer appends its own random suffix, so only a
					// human-readable base goes in - same as the dashboard forms.
					const appName = slugify(name).slice(0, 56);
					const dockerImage =
						input.dockerImage || DEFAULT_DB_IMAGES[databaseType];
					const databasePassword = input.databasePassword || generatePassword();
					const databaseUser =
						databaseType === "redis"
							? undefined
							: input.databaseUser || DEFAULT_DB_USERS[databaseType];
					const databaseName =
						input.databaseName ||
						(databaseType === "postgres" ||
						databaseType === "mysql" ||
						databaseType === "mariadb"
							? DEFAULT_DB_USERS[databaseType]
							: undefined);
					const common = {
						name,
						...(appName ? { appName } : {}),
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
					if (!serviceId || typeof serviceId !== "string") {
						throw new Error(
							"The database record was created but its service id was not returned",
						);
					}

					let deploymentError: string | undefined;
					let runtime: Record<string, unknown> | undefined;
					try {
						await deployDatabase(databaseType, serviceId);
						const verifiedService = (await getService(
							databaseType,
							serviceId,
						)) as any;
						runtime = verifiedService.runtime;
						if (runtime?.ready !== true) {
							throw new Error(
								`Live database verification returned ${String(runtime?.state ?? "unknown")}: ${String(runtime?.message ?? "runtime status unavailable")}`,
							);
						}
					} catch (error) {
						deploymentError =
							error instanceof Error ? error.message : String(error);
					}
					const actualAppName =
						created && typeof created === "object" && created.appName
							? created.appName
							: appName;
					return toResult({
						serviceType: databaseType,
						serviceId,
						name,
						appName: actualAppName,
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
						deployed: !deploymentError,
						status: deploymentError ? "error" : "running",
						runtime: runtime ?? {
							state: "unknown",
							ready: false,
							message:
								deploymentError ?? "Live runtime status was not returned",
						},
						...(deploymentError ? { deploymentError } : {}),
						next: deploymentError
							? "The record and credentials were created, but deployment failed. Inspect the reported Swarm task error before retrying deployService."
							: "The database container is running and ready for the Database IDE.",
					});
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		createApplication: tool({
			description:
				"Create a new application service in an environment. Pass dockerImage to make it deployable right away; otherwise the git/docker source must be configured in the dashboard before it can deploy.",
			inputSchema: z.object({
				environmentId: z.string(),
				name: z.string().min(1),
				serverId: z
					.string()
					.optional()
					.describe(
						"Deploy on this remote server (see listServers). Omit to run on the Dokploy host.",
					),
				dockerImage: z
					.string()
					.optional()
					.describe(
						'Public Docker image to run, e.g. "nginx:alpine". Private registries must be configured in the dashboard.',
					),
				description: z.string().optional(),
			}),
			execute: async ({
				environmentId,
				name,
				serverId,
				dockerImage,
				description,
			}) => {
				try {
					const appName = slugify(name).slice(0, 56);
					const created = (await caller.application.create({
						name,
						...(appName ? { appName } : {}),
						environmentId,
						serverId: serverId || null,
						description: description ?? "",
					} as any)) as any;
					if (dockerImage && created?.applicationId) {
						await caller.application.saveDockerProvider({
							applicationId: created.applicationId,
							dockerImage,
							username: null,
							password: null,
							registryUrl: null,
						} as any);
					}
					return toResult({
						serviceType: "application",
						serviceId: created?.applicationId,
						...pick(created, ["name", "appName"]),
						...(dockerImage ? { dockerImage } : {}),
						next: dockerImage
							? "The docker image is configured. Call deployService to start it."
							: "Configure its source (git provider or docker image) in the dashboard, then deploy.",
					});
				} catch (error) {
					return toErrorResult(error);
				}
			},
		}),
		deleteService: tool({
			description:
				"Permanently delete a service and its container. DESTRUCTIVE and irreversible. confirmName must exactly match the service's current name (check with getService).",
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
				"Permanently delete an environment and EVERY service inside it. DESTRUCTIVE and irreversible. confirmName must exactly match the environment's name.",
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
				"Permanently delete a whole project with ALL its environments and services. DESTRUCTIVE and irreversible. confirmName must exactly match the project's name.",
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
		const setting = resolveToolSetting(name, options.toolConfig);
		if (!setting.enabled) continue;
		const confirmation = options.confirmation;
		if (setting.confirm && options.skipConfirmation) {
			tools[name] = toolDef;
		} else if (setting.confirm && confirmation) {
			tools[name] = {
				...toolDef,
				description: `${toolDef.description ?? ""}${CONFIRMATION_TOOL_NOTE}`,
				execute: async (input: unknown) =>
					await confirmation.request({
						toolName: name,
						summary: summarizeToolCall(name, input),
						toolInput: input,
					}),
			};
		} else if (setting.confirm) {
			// Never silently drop the approval requirement on surfaces that
			// cannot collect one (e.g. the dashboard chat).
			tools[name] = {
				...toolDef,
				execute: async () =>
					toResult(
						`${name} requires user approval, which this chat surface cannot collect. Ask the user to do it from the dashboard, or from a connected channel where approvals work.`,
					),
			};
		} else {
			tools[name] = toolDef;
		}
	}
	return tools;
};
