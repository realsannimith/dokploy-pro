#!/usr/bin/env node

import process from "node:process";
import type { AgentToolConfig } from "@dokploy/server/db/schema/agent";
import { fetchAiModels } from "@dokploy/server/utils/ai/fetch-ai-models";
import {
	AI_PROVIDER_PRESETS,
	isKeyOptional,
} from "@dokploy/server/utils/ai/providers";
import packageInfo from "./package.json";
import { HarnessComposer } from "./server/agent/terminal-composer";
import {
	COMMAND_HELP,
	dimText,
	errorText,
	friendlyToolName,
	HARNESS_USAGE,
	HarnessSpinner,
	HarnessStreamRenderer,
	parseHarnessArgs,
	renderApproval,
	renderBanner,
	renderMessage,
	renderRule,
	renderSessionPanel,
	renderToolProgress,
	successText,
	terminalColorsEnabled,
	warningText,
} from "./server/agent/terminal-ui";

const SOURCE = "terminal" as const;
const HISTORY_PREVIEW_LIMIT = 8;

interface HarnessAgent {
	agentId: string;
	organizationId: string;
	aiId: string | null;
	name: string;
	model: string | null;
	isEnabled: boolean;
	toolConfig: AgentToolConfig;
	ai: {
		aiId: string;
		name: string;
		apiUrl: string;
		apiKey: string;
		model: string;
		isEnabled: boolean;
	} | null;
	organization: { id: string; name: string };
}

interface HarnessProvider {
	aiId: string;
	name: string;
	apiUrl: string;
	apiKey: string;
	model: string;
	isEnabled: boolean;
	organizationId: string;
}

let db: typeof import("@dokploy/server/db").db;
let attachConversationToExternalChat: typeof import("@dokploy/server/services/agent").attachConversationToExternalChat;
let createPendingAction: typeof import("@dokploy/server/services/agent").createPendingAction;
let detachConversation: typeof import("@dokploy/server/services/agent").detachConversation;
let findAgentMemories: typeof import("@dokploy/server/services/agent").findAgentMemories;
let findAgentSkills: typeof import("@dokploy/server/services/agent").findAgentSkills;
let findConversationByExternalChat: typeof import("@dokploy/server/services/agent").findConversationByExternalChat;
let findConversationsForSource: typeof import("@dokploy/server/services/agent").findConversationsForSource;
let findMessagesByConversationId: typeof import("@dokploy/server/services/agent").findMessagesByConversationId;
let findOrCreateConversation: typeof import("@dokploy/server/services/agent").findOrCreateConversation;
let recordAgentSkillUse: typeof import("@dokploy/server/services/agent").recordAgentSkillUse;
let renameConversation: typeof import("@dokploy/server/services/agent").renameConversation;
let undoLastConversationExchange: typeof import("@dokploy/server/services/agent").undoLastConversationExchange;
let updateAgentSettings: typeof import("@dokploy/server/services/agent").updateAgentSettings;
let getAiSettingsByOrganizationId: typeof import("@dokploy/server/services/ai").getAiSettingsByOrganizationId;
let saveAiSettings: typeof import("@dokploy/server/services/ai").saveAiSettings;
let resolvePendingAction: typeof import("./server/agent/pending").resolvePendingAction;
let runAgent: typeof import("./server/agent/run-agent").runAgent;
let LEARN_SKILL_CONTEXT: typeof import("./server/agent/skills").LEARN_SKILL_CONTEXT;
let resolveSkillInvocation: typeof import("./server/agent/skills").resolveSkillInvocation;
let AGENT_TOOL_META: typeof import("./server/agent/tools").AGENT_TOOL_META;
let resolveToolSetting: typeof import("./server/agent/tools").resolveToolSetting;

const loadRuntime = async () => {
	const [dbModule, services, aiServices, pending, runner, skills, tools] =
		await Promise.all([
			import("@dokploy/server/db"),
			import("@dokploy/server/services/agent"),
			import("@dokploy/server/services/ai"),
			import("./server/agent/pending"),
			import("./server/agent/run-agent"),
			import("./server/agent/skills"),
			import("./server/agent/tools"),
		]);
	db = dbModule.db;
	({
		attachConversationToExternalChat,
		createPendingAction,
		detachConversation,
		findAgentMemories,
		findAgentSkills,
		findConversationByExternalChat,
		findConversationsForSource,
		findMessagesByConversationId,
		findOrCreateConversation,
		recordAgentSkillUse,
		renameConversation,
		undoLastConversationExchange,
		updateAgentSettings,
	} = services);
	({ getAiSettingsByOrganizationId, saveAiSettings } = aiServices);
	resolvePendingAction = pending.resolvePendingAction;
	runAgent = runner.runAgent;
	LEARN_SKILL_CONTEXT = skills.LEARN_SKILL_CONTEXT;
	resolveSkillInvocation = skills.resolveSkillInvocation;
	AGENT_TOOL_META = tools.AGENT_TOOL_META;
	resolveToolSetting = tools.resolveToolSetting;
};

const parseCommand = (value: string) => {
	const normalized = value.trim();
	const [token = "", ...rest] = normalized.split(/\s+/);
	const lowered = token.toLowerCase();
	const bareCommands = new Set(["clear", "help", "model", "new", "provider"]);
	return {
		command: token.startsWith("/")
			? lowered
			: bareCommands.has(lowered)
				? `/${lowered}`
				: undefined,
		args: rest.join(" ").trim(),
		text: normalized,
	};
};

const main = async () => {
	let args: ReturnType<typeof parseHarnessArgs>;
	try {
		args = parseHarnessArgs(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n\n${HARNESS_USAGE}\n`,
		);
		process.exit(2);
	}

	if (args.help) {
		process.stdout.write(`${HARNESS_USAGE}\n`);
		return;
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		process.stderr.write(
			"dokploypro-harness needs an interactive terminal. Run it directly from your server shell.\n",
		);
		process.exit(1);
	}

	const colors = terminalColorsEnabled();
	const spinner = new HarnessSpinner(process.stdout, colors);
	let activeAbort: AbortController | undefined;
	let activeStream: HarnessStreamRenderer | undefined;
	let closed = false;
	let goodbyeWritten = false;
	let composer: HarnessComposer;
	composer = new HarnessComposer(
		process.stdin,
		process.stdout,
		colors,
		() => {
			if (activeAbort) {
				activeAbort.abort();
				activeStream?.pause();
				spinner.stop();
				process.stdout.write(`${warningText("Interrupted.", colors)}\n`);
				return;
			}
			closed = true;
			process.stdout.write(`\n${dimText("Goodbye! ◈", colors)}\n`);
			goodbyeWritten = true;
			composer.close();
		},
		() => {
			closed = true;
		},
	);

	try {
		await loadRuntime();
		const agent = await selectAgent(composer, args.agentId);
		if (!agent) return;
		validateAgent(agent);
		const sessionKey = (
			args.sessionKey ||
			process.env.DOKPLOY_HARNESS_SESSION ||
			"local-terminal"
		).slice(0, 160);
		const sessionStartedAt = Date.now();
		let availableTools = 0;
		let availableSkills = 0;

		const redrawHeader = async () => {
			const [skills, memories, conversation] = await Promise.all([
				findAgentSkills(agent.agentId),
				findAgentMemories(agent.agentId),
				findConversationByExternalChat(agent.agentId, SOURCE, sessionKey),
			]);
			availableTools = AGENT_TOOL_META.filter(
				(meta) => resolveToolSetting(meta.name, agent.toolConfig).enabled,
			).length;
			availableSkills = skills.length;
			process.stdout.write(
				`${renderBanner(process.stdout.columns ?? 80, packageInfo.version, colors)}\n\n`,
			);
			process.stdout.write(
				`${renderSessionPanel(
					{
						agent: agent.name,
						organization: agent.organization.name,
						model: agent.model || agent.ai?.model || "Not configured",
						session: conversation?.title || "Fresh terminal session",
						tools: availableTools,
						skills: skills.length,
						memories: memories.length,
					},
					process.stdout.columns ?? 80,
					colors,
				)}\n`,
			);
			process.stdout.write(
				`${dimText("Type your message or /help for commands.", colors)}\n`,
			);
		};

		await redrawHeader();
		if (args.showHistory) {
			await showRecentHistory(agent.agentId, sessionKey, agent.name, colors);
		}

		let retryText: string | null | undefined;
		while (!closed) {
			const statusConversation = await findConversationByExternalChat(
				agent.agentId,
				SOURCE,
				sessionKey,
			);
			const statusMessageCount = statusConversation
				? (
						await findMessagesByConversationId(
							statusConversation.conversationId,
						)
					).length
				: 0;
			const answer = await composer.ask({
				status: {
					model: agent.model || agent.ai?.model || "Not configured",
					session: statusConversation?.title || "Fresh terminal session",
					messages: statusMessageCount,
					tools: availableTools,
					skills: availableSkills,
					elapsedMs: Date.now() - sessionStartedAt,
					state: "ready",
				},
				placeholder: "Ask Dokploy anything…",
				allowMultiline: true,
			});
			if (answer === null) break;
			let { command, args: commandArgs, text } = parseCommand(answer);
			if (!text) continue;

			if (command === "/exit" || command === "/quit") break;
			if (command === "/help") {
				process.stdout.write(`\n${COMMAND_HELP}\n`);
				continue;
			}
			if (command === "/clear") {
				process.stdout.write("\u001Bc");
				await redrawHeader();
				continue;
			}
			if (command === "/model") {
				await configureModel(composer, agent, commandArgs, colors);
				continue;
			}
			if (command === "/provider") {
				await configureProvider(composer, agent, commandArgs, colors);
				continue;
			}
			if (command === "/new" || command === "/reset") {
				const detached = await detachConversation(
					agent.agentId,
					SOURCE,
					sessionKey,
				);
				process.stdout.write(
					`\n${successText(
						detached
							? "Started a fresh session. The previous history is still available with /sessions."
							: "This terminal is already on a fresh session.",
						colors,
					)}\n`,
				);
				continue;
			}
			if (command === "/sessions") {
				await showSessions(agent.agentId, sessionKey, commandArgs, colors);
				continue;
			}
			if (command === "/resume") {
				await resumeSession(
					agent.agentId,
					sessionKey,
					commandArgs,
					agent.name,
					colors,
				);
				continue;
			}
			if (command === "/status") {
				await showStatus(agent, sessionKey, colors);
				continue;
			}
			if (command === "/title") {
				await titleSession(agent.agentId, sessionKey, commandArgs, colors);
				continue;
			}
			if (command === "/undo" || command === "/retry") {
				const conversation = await findConversationByExternalChat(
					agent.agentId,
					SOURCE,
					sessionKey,
				);
				if (!conversation) {
					process.stdout.write(
						`\n${warningText("There is no active session history yet.", colors)}\n`,
					);
					continue;
				}
				retryText = await undoLastConversationExchange(
					conversation.conversationId,
				);
				if (!retryText) {
					process.stdout.write(
						`\n${warningText("There is no exchange to undo.", colors)}\n`,
					);
					continue;
				}
				if (command === "/undo") {
					process.stdout.write(
						`\n${successText("Removed the last user/assistant exchange.", colors)}\n`,
					);
					continue;
				}
				text = retryText;
				command = undefined;
			}
			if (command === "/skills") {
				await showSkills(agent.agentId, colors);
				continue;
			}
			if (!agent.ai?.isEnabled) {
				process.stdout.write(
					`\n${warningText(
						"No AI provider is active. Use /provider add to configure one, or /provider to select an existing provider.",
						colors,
					)}\n`,
				);
				continue;
			}

			let context: string | undefined;
			if (command === "/learn") {
				text = commandArgs;
				if (!text) {
					process.stdout.write(
						`\n${warningText(
							"Add a workflow after /learn, for example: /learn how we deploy and verify staging",
							colors,
						)}\n`,
					);
					continue;
				}
				context = LEARN_SKILL_CONTEXT;
			} else {
				const skills = await findAgentSkills(agent.agentId);
				const invocation = resolveSkillInvocation(text, skills);
				if (invocation) {
					context = invocation.context;
					await Promise.all(
						invocation.loaded.map((skill) =>
							recordAgentSkillUse(skill.skillId),
						),
					);
				}
			}

			process.stdout.write(
				`\n${renderMessage(
					"user",
					text,
					colors,
					process.stdout.columns ?? 80,
					agent.name,
				)}\n`,
			);
			const conversation = await findOrCreateConversation({
				agentId: agent.agentId,
				source: SOURCE,
				externalChatId: sessionKey,
				title: text.slice(0, 80),
			});
			activeAbort = new AbortController();
			const stream = new HarnessStreamRenderer(
				process.stdout,
				colors,
				() => spinner.finish(),
				agent.name,
			);
			activeStream = stream;
			spinner.start("pondering...");
			try {
				const result = await runAgent({
					agentId: agent.agentId,
					message: text,
					source: SOURCE,
					externalChatId: sessionKey,
					conversationId: conversation.conversationId,
					context,
					abortSignal: activeAbort.signal,
					onTextDelta: (delta) => stream.push(delta),
					onToolStart: ({ toolName }) => {
						stream.pause();
						spinner.update(`running ${friendlyToolName(toolName)}...`);
					},
					confirmation: {
						mode: "inline",
						request: async ({ toolName, summary, toolInput }) => {
							stream.pause();
							spinner.stop();
							const action = await createPendingAction({
								agentId: agent.agentId,
								conversationId: conversation.conversationId,
								toolName,
								toolInput,
								summary,
							});
							process.stdout.write(`\n${renderApproval(summary, colors)}\n`);
							const approval = await composer.ask({
								label: "Approve once? [y/N]",
								placeholder: "No",
								tone: "warning",
								allowMultiline: false,
								recordHistory: false,
							});
							const approved = /^(?:y|yes)$/i.test((approval ?? "").trim());
							spinner.start("resuming...");
							const resolved = await resolvePendingAction(
								action.actionId,
								approved,
								"local terminal user",
							);
							return approved
								? `APPROVED AND EXECUTED: ${summary}\nResult: ${resolved.text}`
								: `USER REJECTED: ${summary}. Nothing was changed.`;
						},
					},
					onProgress: async ({ step, toolName, success, durationMs }) => {
						stream.pause();
						spinner.stop();
						process.stdout.write(
							`${renderToolProgress(
								step,
								toolName,
								success,
								durationMs,
								colors,
							)}\n`,
						);
						spinner.start("pondering...");
					},
				});
				if (stream.finish()) {
					spinner.stop();
				} else {
					spinner.finish();
					process.stdout.write(
						`\n${renderMessage(
							"assistant",
							result.text,
							colors,
							process.stdout.columns ?? 80,
							agent.name,
						)}\n`,
					);
				}
			} catch (error) {
				stream.pause();
				spinner.stop();
				if (activeAbort.signal.aborted) {
					process.stdout.write(
						`${warningText("The active turn was interrupted.", colors)}\n`,
					);
				} else {
					process.stdout.write(
						`${errorText(
							`Agent error: ${
								error instanceof Error ? error.message : String(error)
							}`,
							colors,
						)}\n`,
					);
				}
			} finally {
				activeAbort = undefined;
				activeStream = undefined;
			}
		}
	} finally {
		spinner.stop();
		composer.close();
		if (!goodbyeWritten) {
			process.stdout.write(`${dimText("Goodbye! ◈", colors)}\n`);
		}
		// The shared database pool intentionally lives for the server process.
		// This is a short-lived CLI, so exit after readline and stdout settle.
		setImmediate(() => process.exit(0));
	}
};

const selectAgent = async (
	composer: HarnessComposer,
	wantedId: string | undefined,
): Promise<HarnessAgent | null> => {
	const agents = (await db.query.agent.findMany({
		with: { ai: true, organization: true },
	})) as HarnessAgent[];
	if (agents.length === 0) {
		throw new Error(
			"No AI agent is configured. Open Settings -> AI Agent in Dokploy first.",
		);
	}
	if (wantedId) {
		const selected = agents.find(
			(candidate) =>
				candidate.agentId === wantedId ||
				candidate.agentId.startsWith(wantedId) ||
				candidate.organizationId === wantedId,
		);
		if (!selected)
			throw new Error(`No configured agent matched "${wantedId}".`);
		return selected;
	}
	const enabled = agents.filter((candidate) => candidate.isEnabled);
	if (enabled.length === 1 && enabled[0]) return enabled[0];
	const candidates = enabled.length > 0 ? enabled : agents;
	process.stdout.write("\nChoose an agent:\n");
	for (const [index, candidate] of candidates.entries()) {
		process.stdout.write(
			`  ${index + 1}. ${candidate.name} · ${candidate.organization.name}${
				candidate.isEnabled ? "" : " (disabled)"
			}\n`,
		);
	}
	const answer = await composer.ask({
		label: "Agent number",
		placeholder: "1",
		allowMultiline: false,
		recordHistory: false,
	});
	if (answer === null) return null;
	const index = Number.parseInt(answer.trim(), 10) - 1;
	const selected = candidates[index];
	if (!selected) throw new Error("No agent selected.");
	return selected;
};

const validateAgent = (agent: HarnessAgent) => {
	if (!agent.isEnabled) {
		throw new Error(
			`The agent "${agent.name}" is disabled. Enable it in Settings -> AI Agent.`,
		);
	}
};

const currentModel = (agent: HarnessAgent) =>
	agent.model || agent.ai?.model || "Not configured";

const writeOptions = (
	title: string,
	items: Array<{ title: string; detail?: string; active?: boolean }>,
	colors: boolean,
) => {
	process.stdout.write(`\n${dimText(title, colors)}\n`);
	for (const [index, item] of items.entries()) {
		const marker = item.active
			? successText("●", colors)
			: dimText("○", colors);
		process.stdout.write(
			`  ${marker} ${String(index + 1).padStart(2)}. ${item.title}${
				item.detail ? dimText(` · ${item.detail}`, colors) : ""
			}\n`,
		);
	}
};

const resolveProviderChoice = (
	providers: HarnessProvider[],
	wanted: string,
): HarnessProvider | undefined => {
	const normalized = wanted.trim().toLowerCase();
	const number = Number.parseInt(normalized, 10);
	if (String(number) === normalized && number >= 1) {
		return providers[number - 1];
	}
	return (
		providers.find(
			(provider) =>
				provider.aiId.toLowerCase() === normalized ||
				provider.name.toLowerCase() === normalized,
		) ??
		providers.find(
			(provider) =>
				provider.aiId.toLowerCase().startsWith(normalized) ||
				provider.name.toLowerCase().startsWith(normalized),
		)
	);
};

const activateProvider = async (
	agent: HarnessAgent,
	provider: HarnessProvider,
	colors: boolean,
) => {
	await updateAgentSettings(agent.agentId, {
		aiId: provider.aiId,
		model: null,
	});
	agent.aiId = provider.aiId;
	agent.ai = provider;
	agent.model = null;
	process.stdout.write(
		`\n${successText(
			`Provider switched to ${provider.name} · ${provider.model}`,
			colors,
		)}\n`,
	);
};

const chooseModel = async (
	composer: HarnessComposer,
	models: string[],
	query: string,
	activeModel: string,
	colors: boolean,
): Promise<string | null> => {
	let wanted = query.trim();
	if (!wanted && models.length > 24) {
		process.stdout.write(
			`\n${dimText(
				`${models.length} models available. Search by model or vendor name.`,
				colors,
			)}\n`,
		);
		const search = await composer.ask({
			label: "Model search",
			placeholder: activeModel,
			allowMultiline: false,
			recordHistory: false,
		});
		if (search === null) return null;
		wanted = search.trim();
	}

	const exact = wanted
		? models.find((model) => model.toLowerCase() === wanted.toLowerCase())
		: undefined;
	if (exact) return exact;

	const matches = wanted
		? models.filter((model) =>
				model.toLowerCase().includes(wanted.toLowerCase()),
			)
		: models;
	if (matches.length === 0) {
		process.stdout.write(
			`\n${warningText(`No model matched "${wanted}".`, colors)}\n`,
		);
		return null;
	}
	if (matches.length === 1 && matches[0]) return matches[0];

	const shown = matches.slice(0, 30);
	writeOptions(
		`Models${matches.length > shown.length ? ` · first ${shown.length} of ${matches.length}` : ""}`,
		shown.map((model) => ({
			title: model,
			active: model === activeModel,
		})),
		colors,
	);
	const answer = await composer.ask({
		label: "Model number or name",
		placeholder: activeModel,
		allowMultiline: false,
		recordHistory: false,
	});
	if (answer === null || !answer.trim()) return null;
	const normalized = answer.trim();
	const number = Number.parseInt(normalized, 10);
	if (String(number) === normalized && number >= 1) {
		return shown[number - 1] ?? null;
	}
	const selected = models.find(
		(model) => model.toLowerCase() === normalized.toLowerCase(),
	);
	if (!selected) {
		process.stdout.write(
			`\n${warningText(`No model matched "${normalized}".`, colors)}\n`,
		);
		return null;
	}
	return selected;
};

const configureModel = async (
	composer: HarnessComposer,
	agent: HarnessAgent,
	query: string,
	colors: boolean,
) => {
	if (!agent.ai?.isEnabled) {
		process.stdout.write(
			`\n${warningText("Configure an enabled provider with /provider add first.", colors)}\n`,
		);
		return;
	}
	if (/^(?:default|reset)$/i.test(query.trim())) {
		await updateAgentSettings(agent.agentId, { model: null });
		agent.model = null;
		process.stdout.write(
			`\n${successText(`Using provider default: ${agent.ai.model}`, colors)}\n`,
		);
		return;
	}

	try {
		process.stdout.write(
			`\n${dimText(`Loading models from ${agent.ai.name}…`, colors)}\n`,
		);
		const catalog = await fetchAiModels({
			apiUrl: agent.ai.apiUrl,
			apiKey: agent.ai.apiKey,
		});
		const models = [...new Set(catalog.map((model) => model.id))];
		if (models.length === 0) {
			process.stdout.write(
				`${warningText("This provider returned no models.", colors)}\n`,
			);
			return;
		}
		const selected = await chooseModel(
			composer,
			models,
			query,
			currentModel(agent),
			colors,
		);
		if (!selected) return;
		await updateAgentSettings(agent.agentId, { model: selected });
		agent.model = selected;
		process.stdout.write(
			`\n${successText(`Model switched to ${selected}`, colors)}\n`,
		);
	} catch (error) {
		process.stdout.write(
			`\n${errorText(
				`Could not load models: ${
					error instanceof Error ? error.message : String(error)
				}`,
				colors,
			)}\n`,
		);
	}
};

const addProvider = async (
	composer: HarnessComposer,
	agent: HarnessAgent,
	colors: boolean,
) => {
	writeOptions(
		"Provider setup",
		[
			...AI_PROVIDER_PRESETS.map((preset) => ({
				title: preset.name,
				detail: preset.hint,
			})),
			{ title: "Custom OpenAI-compatible endpoint" },
		],
		colors,
	);
	const typeAnswer = await composer.ask({
		label: "Provider number",
		placeholder: "1",
		allowMultiline: false,
		recordHistory: false,
	});
	if (typeAnswer === null) return;
	const providerNumber = Number.parseInt(typeAnswer.trim(), 10);
	const isCustom = providerNumber === AI_PROVIDER_PRESETS.length + 1;
	const preset = AI_PROVIDER_PRESETS[providerNumber - 1];
	if (!preset && !isCustom) {
		process.stdout.write(
			`\n${warningText("Choose a valid provider number.", colors)}\n`,
		);
		return;
	}

	const nameAnswer = await composer.ask({
		label: "Connection name",
		placeholder: preset?.name || "My provider",
		initialValue: preset?.name || "",
		allowMultiline: false,
		recordHistory: false,
	});
	if (nameAnswer === null) return;
	const name = nameAnswer.trim() || preset?.name || "Custom provider";

	let apiUrl = preset?.apiUrl || "";
	if (!apiUrl) {
		const urlAnswer = await composer.ask({
			label: "API URL",
			placeholder: "https://provider.example.com/v1",
			allowMultiline: false,
			recordHistory: false,
		});
		if (urlAnswer === null) return;
		apiUrl = urlAnswer.trim().replace(/\/+$/, "");
		try {
			const url = new URL(apiUrl);
			if (!/^https?:$/.test(url.protocol))
				throw new Error("unsupported protocol");
		} catch {
			process.stdout.write(
				`\n${warningText("Enter a valid HTTP or HTTPS API URL.", colors)}\n`,
			);
			return;
		}
	}

	const optionalKey = isKeyOptional(apiUrl);
	const keyAnswer = await composer.ask({
		label: "API key",
		placeholder: optionalKey ? "Optional" : "Required",
		maskInput: true,
		allowMultiline: false,
		recordHistory: false,
	});
	if (keyAnswer === null) return;
	const apiKey = keyAnswer.trim();
	if (!apiKey && !optionalKey) {
		process.stdout.write(
			`\n${warningText("This provider requires an API key.", colors)}\n`,
		);
		return;
	}

	let model: string | null = null;
	try {
		process.stdout.write(
			`\n${dimText(`Checking ${name} and loading models…`, colors)}\n`,
		);
		const catalog = await fetchAiModels({ apiUrl, apiKey });
		const models = [...new Set(catalog.map((entry) => entry.id))];
		if (models.length > 0) {
			model = await chooseModel(composer, models, "", models[0] ?? "", colors);
		}
	} catch (error) {
		process.stdout.write(
			`${warningText(
				`Model discovery was unavailable: ${
					error instanceof Error ? error.message : String(error)
				}. You can enter the model manually.`,
				colors,
			)}\n`,
		);
	}
	if (!model) {
		const modelAnswer = await composer.ask({
			label: "Model ID",
			placeholder: "provider/model-name",
			allowMultiline: false,
			recordHistory: false,
		});
		if (modelAnswer === null) return;
		model = modelAnswer.trim();
	}
	if (!model) {
		process.stdout.write(
			`\n${warningText("A model ID is required.", colors)}\n`,
		);
		return;
	}

	try {
		await saveAiSettings(agent.organizationId, {
			name,
			apiUrl,
			apiKey,
			model,
			isEnabled: true,
		});
		const providers = (await getAiSettingsByOrganizationId(
			agent.organizationId,
		)) as HarnessProvider[];
		const created = providers.find(
			(provider) => provider.name === name && provider.apiUrl === apiUrl,
		);
		if (!created)
			throw new Error("The provider was saved but could not be selected");
		await activateProvider(agent, created, colors);
	} catch (error) {
		process.stdout.write(
			`\n${errorText(
				`Could not save provider: ${
					error instanceof Error ? error.message : String(error)
				}`,
				colors,
			)}\n`,
		);
	}
};

const configureProvider = async (
	composer: HarnessComposer,
	agent: HarnessAgent,
	args: string,
	colors: boolean,
) => {
	const normalized = args.trim();
	if (/^(?:add|config|configure|setup)$/i.test(normalized)) {
		await addProvider(composer, agent, colors);
		return;
	}
	try {
		const providers = (
			await getAiSettingsByOrganizationId(agent.organizationId)
		).filter((provider) => provider.isEnabled) as HarnessProvider[];
		if (providers.length === 0) {
			process.stdout.write(
				`\n${warningText(
					"No enabled providers are configured. Starting provider setup.",
					colors,
				)}\n`,
			);
			await addProvider(composer, agent, colors);
			return;
		}

		writeOptions(
			"Configured providers",
			providers.map((provider) => ({
				title: provider.name,
				detail: `${provider.model} · ${provider.apiUrl}`,
				active: provider.aiId === agent.aiId,
			})),
			colors,
		);
		if (/^list$/i.test(normalized)) return;
		if (/^current$/i.test(normalized)) {
			process.stdout.write(
				`${dimText(
					`Active: ${agent.ai?.name || "None"} · ${currentModel(agent)}`,
					colors,
				)}\n`,
			);
			return;
		}

		let wanted = normalized.replace(/^use\s+/i, "");
		if (!wanted) {
			const answer = await composer.ask({
				label: "Provider number or name",
				placeholder: agent.ai?.name || "1",
				allowMultiline: false,
				recordHistory: false,
			});
			if (answer === null) return;
			wanted = answer.trim();
		}
		if (!wanted) return;
		const selected = resolveProviderChoice(providers, wanted);
		if (!selected) {
			process.stdout.write(
				`\n${warningText(`No provider matched "${wanted}".`, colors)}\n`,
			);
			return;
		}
		await activateProvider(agent, selected, colors);
	} catch (error) {
		process.stdout.write(
			`\n${errorText(
				`Could not configure provider: ${
					error instanceof Error ? error.message : String(error)
				}`,
				colors,
			)}\n`,
		);
	}
};

const showRecentHistory = async (
	agentId: string,
	sessionKey: string,
	agentName: string,
	colors: boolean,
) => {
	const conversation = await findConversationByExternalChat(
		agentId,
		SOURCE,
		sessionKey,
	);
	if (!conversation) return;
	const messages = await findMessagesByConversationId(
		conversation.conversationId,
		HISTORY_PREVIEW_LIMIT,
	);
	if (messages.length === 0) return;
	process.stdout.write(
		`\n${dimText(
			`Recent history · ${conversation.title || "Untitled"}`,
			colors,
		)}\n${renderRule(process.stdout.columns ?? 80, colors)}\n`,
	);
	for (const message of messages) {
		process.stdout.write(
			`${renderMessage(
				message.role,
				message.content,
				colors,
				process.stdout.columns ?? 80,
				agentName,
			)}\n\n`,
		);
	}
};

const showSessions = async (
	agentId: string,
	sessionKey: string,
	query: string,
	colors: boolean,
) => {
	const sessions = await findConversationsForSource(
		agentId,
		SOURCE,
		sessionKey,
	);
	const wanted = query.toLowerCase();
	const shown = sessions
		.filter(
			(session) =>
				!wanted ||
				session.title?.toLowerCase().includes(wanted) ||
				session.conversationId.toLowerCase().includes(wanted),
		)
		.slice(0, 10);
	if (shown.length === 0) {
		process.stdout.write(
			`\n${warningText("No matching sessions found.", colors)}\n`,
		);
		return;
	}
	process.stdout.write(`\n${dimText("Recent terminal sessions", colors)}\n`);
	for (const session of shown) {
		process.stdout.write(
			`  ${session.conversationId.slice(0, 10)}  ${session.title || "Untitled"}${
				session.externalChatId === sessionKey ? "  (active)" : ""
			}\n`,
		);
	}
	process.stdout.write(
		`${dimText("Use /resume <id or exact title>.", colors)}\n`,
	);
};

const resumeSession = async (
	agentId: string,
	sessionKey: string,
	wanted: string,
	agentName: string,
	colors: boolean,
) => {
	if (!wanted) {
		process.stdout.write(
			`\n${warningText("Use /resume <id or title>.", colors)}\n`,
		);
		return;
	}
	const sessions = await findConversationsForSource(
		agentId,
		SOURCE,
		sessionKey,
	);
	const normalized = wanted.toLowerCase();
	const selected =
		sessions.find((session) =>
			session.conversationId.toLowerCase().startsWith(normalized),
		) ??
		sessions.find((session) => session.title?.toLowerCase() === normalized);
	if (!selected) {
		process.stdout.write(
			`\n${warningText(`No terminal session matched "${wanted}".`, colors)}\n`,
		);
		return;
	}
	await attachConversationToExternalChat({
		agentId,
		source: SOURCE,
		externalChatId: sessionKey,
		conversationId: selected.conversationId,
	});
	process.stdout.write(
		`\n${successText(`Resumed: ${selected.title || selected.conversationId}`, colors)}\n`,
	);
	await showRecentHistory(agentId, sessionKey, agentName, colors);
};

const showStatus = async (
	agent: HarnessAgent,
	sessionKey: string,
	colors: boolean,
) => {
	const conversation = await findConversationByExternalChat(
		agent.agentId,
		SOURCE,
		sessionKey,
	);
	const messageCount = conversation
		? (await findMessagesByConversationId(conversation.conversationId)).length
		: 0;
	process.stdout.write(
		`\n${renderMessage(
			"system",
			[
				`Agent: ${agent.name}`,
				`Organization: ${agent.organization.name}`,
				`Model: ${agent.model || agent.ai?.model}`,
				`Session: ${conversation?.title || "Fresh terminal session"}`,
				`ID: ${conversation?.conversationId || "Not created yet"}`,
				`Messages: ${messageCount}`,
			].join("\n"),
			colors,
		)}\n`,
	);
};

const titleSession = async (
	agentId: string,
	sessionKey: string,
	title: string,
	colors: boolean,
) => {
	const conversation = await findConversationByExternalChat(
		agentId,
		SOURCE,
		sessionKey,
	);
	if (!conversation) {
		process.stdout.write(
			`\n${warningText("There is no active session to rename.", colors)}\n`,
		);
		return;
	}
	if (!title) {
		process.stdout.write(
			`\n${dimText(`Current title: ${conversation.title || "Untitled"}`, colors)}\n`,
		);
		return;
	}
	await renameConversation(conversation.conversationId, title);
	process.stdout.write(
		`\n${successText(`Session renamed to: ${title}`, colors)}\n`,
	);
};

const showSkills = async (agentId: string, colors: boolean) => {
	const skills = await findAgentSkills(agentId);
	if (skills.length === 0) {
		process.stdout.write(
			`\n${dimText(
				"No reusable skills yet. Use /learn <workflow> to teach one.",
				colors,
			)}\n`,
		);
		return;
	}
	process.stdout.write(`\n${dimText("Reusable skills", colors)}\n`);
	for (const skill of skills) {
		process.stdout.write(
			`  /${skill.name}  ${skill.description} (v${skill.version}, used ${skill.usageCount}×)\n`,
		);
	}
};

void main().catch((error) => {
	process.stderr.write(
		`${errorText(
			`Harness failed: ${error instanceof Error ? error.message : String(error)}`,
			terminalColorsEnabled(),
		)}\n`,
	);
	process.exit(1);
});
