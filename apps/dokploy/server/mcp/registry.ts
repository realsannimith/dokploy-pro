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
			description: `Dokploy API ${type} "${procedurePath}". Calls the same authorized tRPC operation and returns its JSON result.`,
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
