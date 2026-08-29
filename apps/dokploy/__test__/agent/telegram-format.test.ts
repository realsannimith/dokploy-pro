import { describe, expect, it } from "vitest";
import {
	splitTelegramMarkdown,
	stripTelegramMarkdown,
	toTelegramMarkdown,
} from "@/server/agent/gateways/telegram-format";

describe("toTelegramMarkdown", () => {
	it("escapes every character MarkdownV2 reserves", () => {
		expect(toTelegramMarkdown("Deployed api-1 (v2.3)!")).toBe(
			"Deployed api\\-1 \\(v2\\.3\\)\\!",
		);
	});

	it("turns headings into bold lines", () => {
		expect(toTelegramMarkdown("## Deployment status")).toBe(
			"*Deployment status*",
		);
	});

	it("converts bold, italic and strikethrough to the telegram dialect", () => {
		expect(toTelegramMarkdown("**api** is *up* and ~~old~~")).toBe(
			"*api* is _up_ and ~old~",
		);
		expect(toTelegramMarkdown("***critical***")).toBe("*_critical_*");
		expect(toTelegramMarkdown("__bold__")).toBe("*bold*");
	});

	it("renders list items as bullets", () => {
		expect(toTelegramMarkdown("- api\n- web")).toBe("• api\n• web");
	});

	it("keeps inline code intact and escapes its content", () => {
		expect(toTelegramMarkdown("Run `docker ps -a` now")).toBe(
			"Run `docker ps -a` now",
		);
	});

	it("keeps fenced code blocks with their language", () => {
		expect(toTelegramMarkdown("```sh\ndocker ps -a\n```")).toBe(
			"```sh\ndocker ps -a\n```",
		);
	});

	it("closes an unterminated code fence", () => {
		expect(toTelegramMarkdown("```\nline\n")).toBe("```\nline\n```");
	});

	it("escapes backticks inside a code block", () => {
		expect(toTelegramMarkdown("```\necho `id`\n```")).toBe(
			"```\necho \\`id\\`\n```",
		);
	});

	it("keeps links and escapes their url", () => {
		expect(toTelegramMarkdown("[logs](https://app.test/logs?id=1)")).toBe(
			"[logs](https://app.test/logs?id=1)",
		);
		expect(toTelegramMarkdown("[logs](https://app.test/logs_(1))")).toBe(
			"[logs](https://app.test/logs_(1\\))",
		);
	});

	it("does not italicize underscores inside identifiers", () => {
		expect(toTelegramMarkdown("service my_api_name failed")).toBe(
			"service my\\_api\\_name failed",
		);
	});

	it("renders blockquotes", () => {
		expect(toTelegramMarkdown("> note this")).toBe(">note this");
	});
});

describe("splitTelegramMarkdown", () => {
	it("splits on line boundaries under the limit", () => {
		const chunks = splitTelegramMarkdown("aaaa\nbbbb\ncccc", 10);
		expect(chunks).toEqual(["aaaa\nbbbb", "cccc"]);
		for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(10);
	});

	it("closes and reopens a code fence across chunks", () => {
		const chunks = splitTelegramMarkdown("```sh\nline1\nline2\n```", 14);
		expect(chunks[0]?.endsWith("```")).toBe(true);
		expect(chunks[1]?.startsWith("```sh")).toBe(true);
	});

	it("drops empty output", () => {
		expect(splitTelegramMarkdown("")).toEqual([]);
	});
});

describe("stripTelegramMarkdown", () => {
	it("removes the escapes so a rejected message stays readable", () => {
		expect(stripTelegramMarkdown("api\\-1 \\(v2\\.3\\)")).toBe("api-1 (v2.3)");
	});
});
