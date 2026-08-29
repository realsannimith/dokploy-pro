import {
	createAgentMessage,
	findAgentById,
	findPendingActionById,
	isPendingActionExpired,
	updatePendingActionStatus,
} from "@dokploy/server/services/agent";
import type { Tool } from "ai";
import { createAgentCaller } from "./caller";
import { buildAgentTools } from "./tools";

/**
 * The stored input is raw JSON, so schema defaults that the model left out
 * are missing. Re-parse it the way the AI SDK would before executing.
 */
const parseStoredToolInput = (toolDef: Tool, input: unknown) => {
	const schema = (toolDef as { inputSchema?: unknown }).inputSchema as
		| { safeParse?: (value: unknown) => { success: boolean; data?: unknown } }
		| undefined;
	if (typeof schema?.safeParse !== "function") return input;
	const parsed = schema.safeParse(input ?? {});
	return parsed.success ? parsed.data : input;
};

export interface ResolvedActionResult {
	status: "approved" | "rejected" | "expired" | "already-handled";
	summary: string;
	/** Outcome text to show the user in the chat. */
	text: string;
}

/**
 * Called when the user taps Approve/Reject on a confirmation prompt. On
 * approval the stored tool call executes with the same permissions and audit
 * trail as any other agent action; the outcome is appended to the
 * conversation so the model has it as context on the next message.
 */
export const resolvePendingAction = async (
	actionId: string,
	approved: boolean,
	actorLabel?: string,
): Promise<ResolvedActionResult> => {
	const action = await findPendingActionById(actionId);
	const actor = actorLabel || "the user";

	if (action.status !== "pending") {
		return {
			status: "already-handled",
			summary: action.summary,
			text: `This request was already ${action.status}.`,
		};
	}
	if (isPendingActionExpired(action)) {
		await updatePendingActionStatus(actionId, "expired");
		return {
			status: "expired",
			summary: action.summary,
			text: "This confirmation expired. Ask the agent again if you still want it.",
		};
	}
	if (!approved) {
		await updatePendingActionStatus(actionId, "rejected");
		await createAgentMessage({
			conversationId: action.conversationId,
			role: "assistant",
			content: `The user rejected the action: ${action.summary}. Nothing was changed.`,
		});
		return {
			status: "rejected",
			summary: action.summary,
			text: "Rejected — nothing was changed.",
		};
	}

	await updatePendingActionStatus(actionId, "approved");
	const agent = await findAgentById(action.agentId);
	const caller = await createAgentCaller(agent.userId, agent.organizationId);
	// The user already approved this exact call, so the tools are built
	// unguarded — otherwise the approval gate would fire a second time and the
	// action would never run.
	const tools = buildAgentTools(caller, {
		agentId: agent.agentId,
		toolConfig: agent.toolConfig,
		mcpConfig: agent.mcpConfig,
		skipConfirmation: true,
	});
	const toolDef = tools[action.toolName];

	let output: string;
	if (!toolDef?.execute) {
		output = `The tool "${action.toolName}" is disabled or no longer available.`;
	} else {
		try {
			const result = await toolDef.execute(
				parseStoredToolInput(toolDef, action.toolInput),
				{
					toolCallId: actionId,
					messages: [],
				},
			);
			output = typeof result === "string" ? result : JSON.stringify(result);
		} catch (error) {
			output = `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	await createAgentMessage({
		conversationId: action.conversationId,
		role: "assistant",
		content: `Approved by ${actor} — executed: ${action.summary}\nResult: ${output}`,
	});
	return { status: "approved", summary: action.summary, text: output };
};
