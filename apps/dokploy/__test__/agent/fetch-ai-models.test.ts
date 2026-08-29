import { fetchAiModels } from "@dokploy/server/utils/ai/fetch-ai-models";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("AI provider model discovery", () => {
	it("uses static provider catalogs without making a request", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchAiModels({
			apiUrl: "https://api.z.ai/api/paas/v4",
			apiKey: "secret",
		});

		expect(models.map((model) => model.id)).toEqual(["glm-5", "glm-4.7"]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("normalizes and sorts OpenAI-compatible model responses", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [{ id: "z-model" }, { name: "a-model" }, { invalid: true }],
				}),
				{ status: 200 },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchAiModels({
			apiUrl: "https://api.openai.com/v1/",
			apiKey: "secret",
		});

		expect(models.map((model) => model.id)).toEqual(["a-model", "z-model"]);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.openai.com/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: "Bearer secret" }),
			}),
		);
	});

	it("uses the Ollama tags endpoint without requiring a key", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ models: [{ name: "qwen3:latest" }] }), {
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const models = await fetchAiModels({
			apiUrl: "http://localhost:11434",
			apiKey: "",
		});

		expect(models.map((model) => model.id)).toEqual(["qwen3:latest"]);
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:11434/api/tags",
			expect.any(Object),
		);
	});

	it("rejects cloud providers without an API key before requesting", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			fetchAiModels({
				apiUrl: "https://api.openai.com/v1",
				apiKey: "",
			}),
		).rejects.toThrow("API key is required");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
