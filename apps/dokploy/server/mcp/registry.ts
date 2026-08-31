import { z } from "zod";
import { appRouter } from "@/server/api/root";

export interface McpToolDef {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
		additionalProperties?: boolean | Record<string, unknown>;
		[key: string]: unknown;
	};
	/** Dot-separated tRPC procedure path, e.g. "project.create" */
	procedurePath: string;
	type: "query" | "mutation";
}

interface CallableProcedure {
	_def?: {
		type?: "query" | "mutation" | "subscription";
		inputs?: z.ZodType[];
	};
}

const EMPTY_INPUT_SCHEMA: McpToolDef["inputSchema"] = {
	type: "object",
	properties: {},
};

export const MCP_SERVER_INSTRUCTIONS = `Dokploy manages deployments asynchronously. Never claim a deployment succeeded from a deploy mutation alone.

For a manual application or compose deployment:
1. Call deployment-latest and remember its deploymentId (if present).
2. Call application-deploy or compose-deploy.
3. Call deployment-followLatest with afterDeploymentId set to the remembered id. It waits up to 25 seconds and returns a normalized state plus a log tail. Repeat while state is in-progress. Treat timedOut as still pending, not as success.
4. On failed or cancelled results, use deployment-inspect or deployment-readLogs with a larger tail. After success, use application-readLogs for runtime logs; compose runtime logs require a container id and compose-readLogs.

For a git push deployment, first read application-one or compose-one. Automatic push deployment requires autoDeploy=true, triggerType=push, a matching configured branch, and a working provider webhook. Call deployment-latest before pushing, push the commit, then call deployment-followLatest with the old deploymentId as afterDeploymentId. If no newer deployment appears, check auto-deploy, trigger, branch, watch paths, and webhook delivery. Do not trigger a second manual deployment unless the user asks.

Use deployment-follow for a known deploymentId. A terminal result has terminal=true. Only state=succeeded and success=true proves the build/deploy finished successfully. The read-only deployment observation tools are safe to poll and honor the same organization and service permissions as the dashboard.`;

const PROCEDURE_DESCRIPTIONS: Record<string, string> = {
	"application.one":
		"Read an application, including its source, configured branch, autoDeploy flag, triggerType, current stored status, and server. Use before relying on push deployment.",
	"compose.one":
		"Read a compose service, including its source, configured branch, autoDeploy flag, triggerType, current stored status, and server. Use before relying on push deployment.",
	"application.update":
		"Update application settings. To enable deployment after matching git pushes, pass applicationId, autoDeploy=true, and triggerType=push; the provider webhook and branch must also be configured.",
	"compose.update":
		"Update compose settings. To enable deployment after matching git pushes, pass composeId, autoDeploy=true, and triggerType=push; the provider webhook and branch must also be configured.",
	"application.deploy":
		"Queue a fresh application build and deployment. This only confirms queueing; snapshot deployment-latest first, then use deployment-followLatest to obtain the new deployment id and terminal result.",
	"compose.deploy":
		"Queue a fresh compose deployment. This only confirms queueing; snapshot deployment-latest first, then use deployment-followLatest to obtain the new deployment id and terminal result.",
	"deployment.allByType":
		"List deployments newest first for a service or schedule. For agent-friendly normalized status and logs, prefer deployment-latest, deployment-followLatest, or deployment-follow.",
	"deployment.latest":
		"Return the newest application or compose deployment with normalized state, terminal/success flags, timestamps, error message, and an optional build-log tail.",
	"deployment.inspect":
		"Inspect one deployment immediately by deploymentId. Returns normalized status and a build-log tail from the correct build or runtime server.",
	"deployment.follow":
		"Wait up to 25 seconds for a known deploymentId to finish. Returns terminal/success/timedOut flags and build logs; repeat if timedOut=true and state is still in-progress.",
	"deployment.followLatest":
		"Wait for the latest service deployment and follow it toward a terminal state. Pass afterDeploymentId to correlate a git push or deploy mutation with a newly created deployment.",
	"deployment.readLogs":
		"Read the tail of a deployment build/run log from the actual build server. Use after a failed deployment or when more lines are needed than the observation tools returned.",
	"application.readLogs":
		"Read current application container runtime logs after deployment. Supports tail, since, and a safe text search filter.",
	"compose.readLogs":
		"Read current runtime logs for one compose container. Discover its container id first with the docker container discovery queries.",
};

const inputSchemaFor = (
	procedure: CallableProcedure,
): McpToolDef["inputSchema"] => {
	const input = procedure._def?.inputs?.at(-1);
	if (!input) return EMPTY_INPUT_SCHEMA;

	const { $schema: _schemaVersion, ...schema } = z.toJSONSchema(input, {
		// Zod transforms are still enforced by tRPC at execution time. Their JSON
		// Schema representation can safely be unconstrained for tool discovery.
		unrepresentable: "any",
	});
	if (schema.type !== "object") return EMPTY_INPUT_SCHEMA;
	return schema as McpToolDef["inputSchema"];
};

const buildToolsFromRouter = (): Map<string, McpToolDef> => {
	const tools = new Map<string, McpToolDef>();
	const procedures = appRouter._def.procedures as Record<
		string,
		CallableProcedure
	>;

	for (const [procedurePath, procedure] of Object.entries(procedures)) {
		const type = procedure._def?.type;
		// Streaming subscriptions are not callable MCP tools. Queries and
		// mutations cover every request/response Dokploy operation.
		if (type !== "query" && type !== "mutation") continue;

		const name = procedurePath.replace(/\./g, "-");
		if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) continue;

		tools.set(name, {
			name,
			description:
				PROCEDURE_DESCRIPTIONS[procedurePath] ??
				`Dokploy API ${type} "${procedurePath}". Calls the same authorized tRPC operation and returns its JSON result.`,
			inputSchema: inputSchemaFor(procedure),
			procedurePath,
			type,
		});
	}

	return tools;
};

let registry: Map<string, McpToolDef> | null = null;

export const getMcpTools = (): Map<string, McpToolDef> => {
	registry ??= buildToolsFromRouter();
	return registry;
};
