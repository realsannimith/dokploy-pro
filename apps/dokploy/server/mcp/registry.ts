import { generateOpenApiDocument } from "@dokploy/trpc-openapi";
import { appRouter } from "@/server/api/root";

export interface McpToolDef {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
		additionalProperties?: boolean;
	};
	/** Dot-separated tRPC procedure path, e.g. "project.create" */
	procedurePath: string;
	type: "query" | "mutation";
}

const EMPTY_INPUT_SCHEMA: McpToolDef["inputSchema"] = {
	type: "object",
	properties: {},
};

const buildToolsFromDocument = (): Map<string, McpToolDef> => {
	const document = generateOpenApiDocument(appRouter, {
		title: "Dokploy API",
		version: "1.0.0",
		baseUrl: "/api",
	});

	const tools = new Map<string, McpToolDef>();

	for (const [path, methods] of Object.entries(document.paths ?? {})) {
		// Paths are generated as "/<router>.<procedure>"
		const procedurePath = path.replace(/^\//, "");

		for (const [method, operation] of Object.entries(methods ?? {})) {
			if (method !== "get" && method !== "post") continue;
			const op = operation as {
				operationId?: string;
				description?: string;
				parameters?: Array<{
					name: string;
					required?: boolean;
					schema?: Record<string, unknown>;
				}>;
				requestBody?: {
					content?: {
						"application/json"?: { schema?: Record<string, unknown> };
					};
				};
			};

			const name = op.operationId ?? procedurePath.replace(/\./g, "-");
			// MCP tool names must match [a-zA-Z0-9_-]
			if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) continue;

			let inputSchema: McpToolDef["inputSchema"] = EMPTY_INPUT_SCHEMA;

			if (method === "get") {
				const properties: Record<string, unknown> = {};
				const required: string[] = [];
				for (const param of op.parameters ?? []) {
					properties[param.name] = param.schema ?? {};
					if (param.required) required.push(param.name);
				}
				if (Object.keys(properties).length > 0) {
					inputSchema = {
						type: "object",
						properties,
						...(required.length > 0 ? { required } : {}),
					};
				}
			} else {
				const bodySchema = op.requestBody?.content?.["application/json"]
					?.schema as McpToolDef["inputSchema"] | undefined;
				if (bodySchema && bodySchema.type === "object") {
					inputSchema = bodySchema;
				}
			}

			const type = method === "get" ? "query" : "mutation";
			tools.set(name, {
				name,
				description:
					op.description ||
					`Dokploy API ${type} "${procedurePath}". Calls the same operation as ${method.toUpperCase()} /api/${procedurePath} and returns its JSON result.`,
				inputSchema,
				procedurePath,
				type,
			});
		}
	}

	return tools;
};

let registry: Map<string, McpToolDef> | null = null;

export const getMcpTools = (): Map<string, McpToolDef> => {
	registry ??= buildToolsFromDocument();
	return registry;
};
