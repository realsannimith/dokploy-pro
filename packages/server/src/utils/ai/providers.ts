export interface AiProviderPreset {
	/** Stable id used by the UI and by getProviderName heuristics. */
	id: string;
	name: string;
	apiUrl: string;
	/** Shown under the provider in pickers. */
	hint?: string;
	/** Providers that accept an empty API key (local runtimes). */
	keyOptional?: boolean;
	/** Models are hardcoded because the provider has no /models endpoint. */
	staticModels?: string[];
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
	{
		id: "openai",
		name: "OpenAI",
		apiUrl: "https://api.openai.com/v1",
		hint: "GPT and Codex models via API key",
	},
	{
		id: "anthropic",
		name: "Anthropic",
		apiUrl: "https://api.anthropic.com/v1",
		hint: "Claude models",
	},
	{
		id: "gemini",
		name: "Google Gemini",
		apiUrl: "https://generativelanguage.googleapis.com/v1beta",
	},
	{
		id: "nous",
		name: "Nous Portal",
		apiUrl: "https://inference-api.nousresearch.com/v1",
		hint: "Hermes models and 300+ others under one subscription",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		apiUrl: "https://openrouter.ai/api/v1",
		hint: "Router across most commercial and open models",
	},
	{
		id: "groq",
		name: "Groq",
		apiUrl: "https://api.groq.com/openai/v1",
		hint: "Very fast inference for open models",
	},
	{
		id: "xai",
		name: "xAI (Grok)",
		apiUrl: "https://api.x.ai/v1",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		apiUrl: "https://api.deepseek.com/v1",
	},
	{
		id: "mistral",
		name: "Mistral",
		apiUrl: "https://api.mistral.ai/v1",
	},
	{
		id: "cohere",
		name: "Cohere",
		apiUrl: "https://api.cohere.ai/v2",
	},
	{
		id: "together",
		name: "Together AI",
		apiUrl: "https://api.together.xyz/v1",
	},
	{
		id: "fireworks",
		name: "Fireworks AI",
		apiUrl: "https://api.fireworks.ai/inference/v1",
	},
	{
		id: "cerebras",
		name: "Cerebras",
		apiUrl: "https://api.cerebras.ai/v1",
	},
	{
		id: "deepinfra",
		name: "DeepInfra",
		apiUrl: "https://api.deepinfra.com/v1/openai",
	},
	{
		id: "moonshot",
		name: "Moonshot (Kimi)",
		apiUrl: "https://api.moonshot.ai/v1",
	},
	{
		id: "zai",
		name: "Z.AI",
		apiUrl: "https://api.z.ai/api/paas/v4",
		staticModels: ["glm-5", "glm-4.7"],
	},
	{
		id: "minimax",
		name: "MiniMax",
		apiUrl: "https://api.minimax.io/v1",
		staticModels: ["MiniMax-M2.7"],
	},
	{
		id: "perplexity",
		name: "Perplexity",
		apiUrl: "https://api.perplexity.ai",
		staticModels: [
			"sonar-deep-research",
			"sonar-reasoning-pro",
			"sonar-reasoning",
			"sonar-pro",
			"sonar",
		],
	},
	{
		id: "github",
		name: "GitHub Models",
		apiUrl: "https://models.github.ai/inference",
		hint: "Uses a GitHub personal access token",
	},
	{
		id: "ollama",
		name: "Ollama",
		apiUrl: "http://localhost:11434",
		hint: "Local models, no API key needed",
		keyOptional: true,
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		apiUrl: "http://localhost:1234/v1",
		hint: "Local OpenAI-compatible server",
		keyOptional: true,
	},
	{
		id: "vllm",
		name: "vLLM / self-hosted",
		apiUrl: "http://localhost:8000/v1",
		hint: "Any OpenAI-compatible endpoint",
		keyOptional: true,
	},
];

const normalize = (url: string) => url.trim().replace(/\/+$/, "").toLowerCase();

export const findPresetByApiUrl = (apiUrl: string) => {
	const target = normalize(apiUrl || "");
	return AI_PROVIDER_PRESETS.find(
		(preset) => normalize(preset.apiUrl) === target,
	);
};

/**
 * Providers that need no API key: the local runtimes above, plus any Ollama
 * instance on its default port (localhost or a LAN host).
 */
export const isKeyOptional = (apiUrl: string) => {
	if (!apiUrl) return false;
	if (apiUrl.includes(":11434")) return true;
	return AI_PROVIDER_PRESETS.some(
		(preset) => preset.keyOptional && apiUrl.startsWith(preset.apiUrl),
	);
};
