import type { AgentToolCall } from "@dokploy/server/db/schema/agent";
import type { AgentSource } from "@dokploy/server/services/agent";
import {
	createAgentMessage,
	findAgentById,
	findMessagesByConversationId,
	findOrCreateConversation,
} from "@dokploy/server/services/agent";
import { selectAIProvider } from "@dokploy/server/utils/ai/select-ai-provider";
import { generateText, type ModelMessage, stepCountIs } from "ai";
import { createAgentCaller } from "./caller";
import { type AgentConfirmationHandler, buildAgentTools } from "./tools";

const HISTORY_LIMIT = 30;
const MAX_STEPS = 15;

const buildSystemPrompt = (
	agentName: string,
	instructions?: string | null,
	hasConfirmationButtons?: boolean,
) => {
	const base = `You are ${agentName}, the AI operations assistant for a Dokploy instance (an open-source PaaS for deploying applications, docker compose stacks and databases).

You are talking to an authorized administrator of this Dokploy instance, possibly through a chat app like Telegram. Help them inspect and operate their infrastructure using your tools.

Guidelines:
- Use listProjects first when you need to find a service the user mentions by name.
- Every action you take runs through the exact same API the dashboard uses, so results (deployments, backups, audit log) are immediately visible in the Dokploy UI.
- Before stopping services or triggering deployments of something that looks production-critical, briefly confirm with the user unless they clearly asked for it.
- You CAN create projects, environments, databases and applications. After creating a database, share its generated credentials with the user (they are shown only once) and then deploy it with deployService so it actually starts.
- Deleting a service is irreversible: always ask the user to explicitly confirm (by name) before calling deleteService.
- Never invent ids or statuses: always read them with tools.
- You cannot read environment variables or secrets; do not promise to.
- Keep answers short and chat-friendly. Prefer plain text over heavy formatting; small lists are fine. Do not use markdown tables.
- If a tool returns an error, tell the user what failed honestly.

Current date: ${new Date().toISOString()}`;

	const confirmationNote = hasConfirmationButtons
		? `\n\nSome sensitive tools do not run immediately: calling them sends the user an Approve/Reject button prompt in this chat. When a tool responds that a confirmation request was sent, stop and briefly tell the user what will happen once they tap Approve. Never call the same tool again to "retry" while a confirmation is pending.`
		: "";

	if (instructions?.trim()) {
		return `${base}${confirmationNote}\n\nAdditional instructions from the administrator:\n${instructions.trim()}`;
	}
	return `${base}${confirmationNote}`;
};

export interface RunAgentInput {
	agentId: string;
	message: string;
	source: AgentSource;
	conversationId?: string;
	externalChatId?: string;
	/** Gateway-provided handler that shows Approve/Reject buttons to the user. */
	confirmation?: AgentConfirmationHandler;
}

export interface RunAgentResult {
	text: string;
	conversationId: string;
	toolCalls: AgentToolCall[];
}

export const runAgent = async (
	input: RunAgentInput,
): Promise<RunAgentResult> => {
	const agent = await findAgentById(input.agentId);

	if (!agent.isEnabled) {
		throw new Error("The agent is disabled");
	}
	if (!agent.ai?.isEnabled) {
		throw new Error(
			"No enabled AI provider is configured for the agent. Pick one in Settings -> AI Agent.",
		);
	}

	const conversation = await findOrCreateConversation({
		agentId: agent.agentId,
		source: input.source,
		conversationId: input.conversationId,
		externalChatId: input.externalChatId,
		title: input.message.slice(0, 80),
	});

	const history = await findMessagesByConversationId(
		conversation.conversationId,
		HISTORY_LIMIT,
	);

	const messages: ModelMessage[] = [
		...history.map(
			(message): ModelMessage => ({
				role: message.role,
				content: message.content,
			}),
		),
		{ role: "user", content: input.message },
	];

	await createAgentMessage({
		conversationId: conversation.conversationId,
		role: "user",
		content: input.message,
	});

	const caller = await createAgentCaller(agent.userId, agent.organizationId);
	const tools = buildAgentTools(caller, {
		toolConfig: agent.toolConfig,
		confirmation: input.confirmation,
	});

	const provider = selectAIProvider({
		apiUrl: agent.ai.apiUrl,
		apiKey: agent.ai.apiKey,
	});
	const model = provider(agent.model || agent.ai.model);

	const result = await generateText({
		model,
		system: buildSystemPrompt(
			agent.name,
			agent.instructions,
			!!input.confirmation,
		),
		messages,
		tools,
		stopWhen: stepCountIs(MAX_STEPS),
	});

	const toolCalls: AgentToolCall[] = [];
	for (const step of result.steps) {
		for (const toolCall of step.toolCalls) {
			const toolResult = step.toolResults.find(
				(candidate) => candidate.toolCallId === toolCall.toolCallId,
			);
			toolCalls.push({
				toolName: toolCall.toolName,
				input: toolCall.input,
				output:
					typeof toolResult?.output === "string"
						? toolResult.output
						: toolResult?.output != null
							? JSON.stringify(toolResult.output)
							: undefined,
			});
		}
	}

	const text =
		result.text.trim() ||
		(toolCalls.length > 0
			? "Done. (The model returned no summary text.)"
			: "I could not produce a response. Please try rephrasing.");

	await createAgentMessage({
		conversationId: conversation.conversationId,
		role: "assistant",
		content: text,
		toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
	});

	return {
		text,
		conversationId: conversation.conversationId,
		toolCalls,
	};
};
