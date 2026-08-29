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
import { buildAgentTools } from "./tools";

const HISTORY_LIMIT = 30;
const MAX_STEPS = 15;

const buildSystemPrompt = (agentName: string, instructions?: string | null) => {
	const base = `You are ${agentName}, the AI operations assistant for a Dokploy instance (an open-source PaaS for deploying applications, docker compose stacks and databases).

You are talking to an authorized administrator of this Dokploy instance, possibly through a chat app like Telegram. Help them inspect and operate their infrastructure using your tools.

Guidelines:
- Use listProjects first when you need to find a service the user mentions by name.
- Every action you take runs through the exact same API the dashboard uses, so results (deployments, backups, audit log) are immediately visible in the Dokploy UI.
- Before stopping services or triggering deployments of something that looks production-critical, briefly confirm with the user unless they clearly asked for it.
- Never invent ids or statuses: always read them with tools.
- You cannot read environment variables or secrets; do not promise to.
- Keep answers short and chat-friendly. Prefer plain text over heavy formatting; small lists are fine. Do not use markdown tables.
- If a tool returns an error, tell the user what failed honestly.

Current date: ${new Date().toISOString()}`;

	if (instructions?.trim()) {
		return `${base}\n\nAdditional instructions from the administrator:\n${instructions.trim()}`;
	}
	return base;
};

export interface RunAgentInput {
	agentId: string;
	message: string;
	source: AgentSource;
	conversationId?: string;
	externalChatId?: string;
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
	const tools = buildAgentTools(caller);

	const provider = selectAIProvider({
		apiUrl: agent.ai.apiUrl,
		apiKey: agent.ai.apiKey,
	});
	const model = provider(agent.model || agent.ai.model);

	const result = await generateText({
		model,
		system: buildSystemPrompt(agent.name, agent.instructions),
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
