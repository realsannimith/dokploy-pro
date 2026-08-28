import { validateRequest } from "@dokploy/server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { getMcpTools } from "@/server/mcp/registry";

export const config = {
	api: {
		externalResolver: true,
		responseLimit: false,
	},
};

const callProcedure = async (
	req: NextApiRequest,
	res: NextApiResponse,
	procedurePath: string,
	args: unknown,
) => {
	const ctx = await createTRPCContext({ req, res } as Parameters<
		typeof createTRPCContext
	>[0]);
	const caller = appRouter.createCaller(ctx);

	let procedure: unknown = caller;
	for (const segment of procedurePath.split(".")) {
		procedure = (procedure as Record<string, unknown>)?.[segment];
	}
	if (typeof procedure !== "function") {
		throw new Error(`Unknown procedure: ${procedurePath}`);
	}
	return await (procedure as (input: unknown) => Promise<unknown>)(args);
};

const formatError = (error: unknown): string => {
	if (error instanceof TRPCError) {
		const zodError =
			error.cause && error.cause.constructor?.name === "ZodError"
				? `\n${error.cause}`
				: "";
		return `${error.code}: ${error.message}${zodError}`;
	}
	return error instanceof Error ? error.message : String(error);
};

const buildMcpServer = (req: NextApiRequest, res: NextApiResponse) => {
	const server = new Server(
		{ name: "dokploy", version: "1.0.0" },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [...getMcpTools().values()].map((tool) => ({
			name: tool.name,
			description: tool.description,
			inputSchema: tool.inputSchema,
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const tool = getMcpTools().get(request.params.name);
		if (!tool) {
			return {
				content: [
					{ type: "text", text: `Unknown tool: ${request.params.name}` },
				],
				isError: true,
			};
		}

		try {
			const result = await callProcedure(
				req,
				res,
				tool.procedurePath,
				request.params.arguments ?? {},
			);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(result ?? null, null, 2),
					},
				],
			};
		} catch (error) {
			return {
				content: [{ type: "text", text: formatError(error) }],
				isError: true,
			};
		}
	});

	return server;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
	if (req.method !== "POST") {
		res.status(405).json({
			jsonrpc: "2.0",
			error: {
				code: -32000,
				message:
					"Method not allowed. This MCP endpoint is stateless: connect with the Streamable HTTP transport and POST JSON-RPC messages.",
			},
			id: null,
		});
		return;
	}

	const { user, session } = await validateRequest(req);
	if (!user || !session) {
		res.status(401).json({
			jsonrpc: "2.0",
			error: {
				code: -32001,
				message:
					"Unauthorized: provide a valid Dokploy API key in the x-api-key header.",
			},
			id: null,
		});
		return;
	}

	// Be lenient with clients that only send one of the two accept types the
	// transport requires; responses are always JSON here.
	req.headers.accept = "application/json, text/event-stream";

	const server = buildMcpServer(req, res);
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});

	res.on("close", () => {
		void transport.close();
		void server.close();
	});

	try {
		await server.connect(transport);
		await transport.handleRequest(req, res, req.body);
	} catch (error) {
		if (!res.headersSent) {
			res.status(500).json({
				jsonrpc: "2.0",
				error: {
					code: -32603,
					message: error instanceof Error ? error.message : "Internal error",
				},
				id: null,
			});
		}
	}
};

export default handler;
