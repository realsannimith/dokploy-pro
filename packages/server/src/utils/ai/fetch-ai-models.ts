import { findPresetByApiUrl, isKeyOptional } from "./providers";
import {
	getProviderHeaders,
	getProviderName,
	type Model,
} from "./select-ai-provider";

const toModel = (value: unknown, owner = "provider"): Model | null => {
	if (typeof value === "string" && value.trim()) {
		return {
			id: value.trim(),
			object: "model",
			created: Date.now(),
			owned_by: owner,
		};
	}
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const id = record.id ?? record.name;
	if (typeof id !== "string" || !id.trim()) return null;
	return {
		id: id.trim(),
		object: typeof record.object === "string" ? record.object : "model",
		created: typeof record.created === "number" ? record.created : Date.now(),
		owned_by: typeof record.owned_by === "string" ? record.owned_by : owner,
	};
};

export const fetchAiModels = async (input: {
	apiUrl: string;
	apiKey: string;
}): Promise<Model[]> => {
	const apiUrl = input.apiUrl.trim().replace(/\/+$/, "");
	const providerName = getProviderName(apiUrl);
	const preset = findPresetByApiUrl(apiUrl);
	if (preset?.staticModels) {
		return preset.staticModels
			.map((model) => toModel(model, preset.id))
			.filter((model): model is Model => Boolean(model));
	}
	if (!input.apiKey && !isKeyOptional(apiUrl)) {
		throw new Error("An API key is required for this provider");
	}

	const headers = getProviderHeaders(apiUrl, input.apiKey);
	const response =
		providerName === "ollama"
			? await fetch(`${apiUrl}/api/tags`, { headers })
			: providerName === "gemini"
				? await fetch(
						`${apiUrl}/models?key=${encodeURIComponent(input.apiKey)}`,
						{ headers: {} },
					)
				: await fetch(`${apiUrl}/models`, { headers });

	if (!response.ok) {
		const details = (await response.text()).trim();
		throw new Error(
			`Failed to fetch models (${response.status})${
				details ? `: ${details.slice(0, 300)}` : ""
			}`,
		);
	}

	const payload = (await response.json()) as unknown;
	const records = Array.isArray(payload)
		? payload
		: payload && typeof payload === "object"
			? ((payload as Record<string, unknown>).models ??
				(payload as Record<string, unknown>).data ??
				Object.values(payload as Record<string, unknown>).find(Array.isArray) ??
				[])
			: [];
	if (!Array.isArray(records)) return [];

	return records
		.map((model) => toModel(model, providerName))
		.filter((model): model is Model => Boolean(model))
		.sort((left, right) => left.id.localeCompare(right.id));
};
