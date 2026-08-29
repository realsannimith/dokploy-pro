import { describe, expect, it } from "vitest";
import {
	parseHarnessArgs,
	renderBanner,
	renderMarkdown,
	renderSessionPanel,
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
		).toBe("● Step 2 · read deployment logs · 1.3s");
	});
});
