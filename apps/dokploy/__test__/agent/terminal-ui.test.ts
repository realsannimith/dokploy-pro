import { describe, expect, it } from "vitest";
import { renderComposerView } from "@/server/agent/terminal-composer";
import {
	HarnessStreamRenderer,
	parseHarnessArgs,
	renderBanner,
	renderMarkdown,
	renderSessionPanel,
	renderStatusBar,
	renderToolProgress,
	stripAnsi,
} from "@/server/agent/terminal-ui";

describe("Dokploy Pro terminal harness UI", () => {
	it("parses agent, session, history, and help options", () => {
		expect(
			parseHarnessArgs([
				"--agent",
				"agent-1",
				"--session",
				"staging",
				"--no-history",
			]),
		).toEqual({
			agentId: "agent-1",
			sessionKey: "staging",
			showHistory: false,
			help: false,
		});
		expect(parseHarnessArgs(["-h"]).help).toBe(true);
		expect(() => parseHarnessArgs(["--agent"])).toThrow(
			"--agent requires a value",
		);
		expect(() => parseHarnessArgs(["--unknown"])).toThrow("Unknown option");
	});

	it("uses responsive branding at wide and narrow terminal widths", () => {
		const wide = stripAnsi(renderBanner(100, "v1.2.3"));
		const compact = stripAnsi(renderBanner(54, "v1.2.3"));
		const tiny = stripAnsi(renderBanner(30, "v1.2.3"));

		expect(wide).toContain("██████╗");
		expect(wide).toContain("PRO HARNESS");
		expect(compact).toContain("DOKPLOY PRO HARNESS");
		expect(tiny).toBe("◈ DOKPLOY PRO");
	});

	it("renders a bounded session panel with gateway capabilities", () => {
		const panel = stripAnsi(
			renderSessionPanel(
				{
					agent: "Operations Agent",
					organization: "Acme",
					model: "provider/a-very-long-model-name",
					session: "Deploy staging",
					tools: 30,
					skills: 4,
					memories: 2,
				},
				64,
			),
		);
		expect(panel).toContain("SESSION");
		expect(panel).toContain("30 tools · 4 skills · 2 memories");
		for (const line of panel.split("\n")) {
			expect([...line].length).toBeLessThanOrEqual(62);
		}

		const narrow = stripAnsi(
			renderSessionPanel(
				{
					agent: "Operations Agent",
					organization: "Acme",
					model: "model",
					session: "session",
					tools: 30,
					skills: 4,
					memories: 2,
				},
				30,
			),
		);
		for (const line of narrow.split("\n")) {
			expect([...line].length).toBeLessThanOrEqual(28);
		}
	});

	it("renders chat markdown and readable tool progress", () => {
		const markdown = stripAnsi(
			renderMarkdown("## Result\n- **api** is `healthy`\n> verified"),
		);
		expect(markdown).toBe("Result\n• api is healthy\n┊ verified");
		expect(
			stripAnsi(renderToolProgress(2, "readDeploymentLogs", true, 1250)),
		).toBe("  ┊ ≋ read deployment logs (1.3s) · #2");
	});

	it("renders a responsive Hermes-style status line", () => {
		const status = stripAnsi(
			renderStatusBar(
				{
					model: "provider/operations-model",
					session: "Deploy staging safely",
					messages: 12,
					tools: 30,
					skills: 4,
					elapsedMs: 125_000,
				},
				100,
			),
		);
		expect(status).toContain("⚕ provider/operations-model");
		expect(status).toContain("12 msgs");
		expect(status).toContain("30 tools");
		expect(status).toContain("4 skills");
		expect(status).toContain("2m");
		expect(status).toContain("─ ready │");
		expect(status).toContain("Deploy staging safely");
	});

	it("renders the Hermes-style chat composer with placeholder and wrapping", () => {
		const question = {
			status: {
				model: "provider/operations-model",
				session: "Deploy staging",
				messages: 12,
				tools: 30,
				skills: 4,
				elapsedMs: 125_000,
			},
			placeholder: "Ask Dokploy anything…",
		};
		const empty = renderComposerView(question, "", 0, 80, false);
		expect(empty.text).toContain("─ ready │");
		expect(empty.text).toContain("❯ Ask Dokploy anything…");
		expect(empty.cursorRow).toBe(2);
		expect(empty.cursorColumn).toBe(2);

		const multiline = renderComposerView(
			question,
			"Deploy the application safely\nand verify the health check",
			24,
			34,
			false,
		);
		expect(multiline.rows).toBeGreaterThan(3);
		expect(multiline.text).toContain("❯ Deploy the application safely");
		expect(multiline.text).toContain("  and verify the health check");
	});

	it("streams assistant deltas with a live cursor and inline styling", () => {
		const chunks: string[] = [];
		let started = 0;
		const stream = new HarnessStreamRenderer(
			{
				write: (chunk) => {
					chunks.push(String(chunk));
					return true;
				},
			},
			true,
			() => {
				started += 1;
			},
		);
		stream.push("Hello **oper");
		stream.push("ator**. Use `status` now.");
		expect(stream.finish()).toBe(true);

		const output = stripAnsi(chunks.join(""));
		const settledOutput = output.replace(/▍ ?/g, "");
		expect(started).toBe(1);
		expect(output).toContain("◆ Agent");
		expect(settledOutput).toContain("Hello operator. Use status now.");
		expect(output).toContain("▍");
		expect(output).not.toContain("**");
	});
});
