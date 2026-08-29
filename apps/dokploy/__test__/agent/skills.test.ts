import { describe, expect, it } from "vitest";
import { parseGatewayCommand } from "@/server/agent/gateways/dispatch";
import {
	formatSkillIndex,
	resolveSkillInvocation,
} from "@/server/agent/skills";

const skill = (name: string, content = `# ${name}`) => ({
	skillId: `${name}-id`,
	agentId: "agent-1",
	name,
	description: `${name} description`,
	content,
	origin: "agent" as const,
	version: 2,
	usageCount: 0,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("agent skills", () => {
	it("keeps the prompt index compact", () => {
		expect(formatSkillIndex([skill("deploy-api")])).toBe(
			"- /deploy-api (v2): deploy-api description",
		);
	});

	it("loads stacked leading skill commands and preserves the request", () => {
		const resolved = resolveSkillInvocation(
			"/deploy-api /check-health deploy production",
			[skill("deploy-api"), skill("check-health")],
		);
		expect(resolved?.loaded.map((item) => item.name)).toEqual([
			"deploy-api",
			"check-health",
		]);
		expect(resolved?.context).toContain("deploy production");
	});

	it("accepts Telegram's bot-qualified slash commands", () => {
		const resolved = resolveSkillInvocation("/deploy-api@dokploy_bot staging", [
			skill("deploy-api"),
		]);
		expect(resolved?.loaded[0]?.name).toBe("deploy-api");
	});

	it("does not consume unknown slash commands", () => {
		expect(resolveSkillInvocation("/help", [skill("deploy-api")])).toBeNull();
	});

	it("normalizes commands shared by every gateway", () => {
		expect(parseGatewayCommand("/new@dokploy_bot")).toMatchObject({
			command: "/new",
			args: "",
		});
		expect(
			parseGatewayCommand("<@U123BOT> /resume production api"),
		).toMatchObject({
			command: "/resume",
			args: "production api",
		});
		expect(parseGatewayCommand("deploy the api").command).toBeUndefined();
	});
});
