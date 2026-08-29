import type { agentSkill } from "@dokploy/server/db/schema/agent";

type AgentSkill = typeof agentSkill.$inferSelect;

const MAX_INVOKED_SKILLS = 5;

export const formatSkillIndex = (
	skills: Pick<AgentSkill, "name" | "description" | "version">[],
) => {
	if (skills.length === 0) return "(No skills learned yet.)";
	return skills
		.map(
			(skill) => `- /${skill.name} (v${skill.version}): ${skill.description}`,
		)
		.join("\n");
};

/**
 * Resolve up to five leading /skill-name tokens. Full skill content is added
 * as ephemeral turn context, so stored user messages and the stable system
 * prompt stay small and readable.
 */
export const resolveSkillInvocation = (text: string, skills: AgentSkill[]) => {
	const byName = new Map(skills.map((skill) => [skill.name, skill]));
	const tokens = text.trim().split(/\s+/);
	const loaded: AgentSkill[] = [];
	let consumed = 0;

	for (const token of tokens.slice(0, MAX_INVOKED_SKILLS)) {
		if (!token.startsWith("/")) break;
		const name = token.slice(1).split("@")[0]?.toLowerCase();
		const skill = name ? byName.get(name) : undefined;
		if (!skill) break;
		loaded.push(skill);
		consumed += 1;
	}

	if (loaded.length === 0) return null;
	const request = tokens.slice(consumed).join(" ").trim();
	return {
		loaded,
		context: `<loaded_skills>\n${loaded
			.map(
				(skill) =>
					`<skill name="${skill.name}" version="${skill.version}">\n${skill.content}\n</skill>`,
			)
			.join(
				"\n\n",
			)}\n</loaded_skills>\n\nFollow the loaded skill instructions for this turn. The user's request after the skill command is: ${request || "Ask what they would like to do with the loaded skill."}`,
	};
};

export const LEARN_SKILL_CONTEXT =
	"The user invoked /learn. Treat the text after /learn as source material or a workflow they want made reusable. Use existing tools to understand it when needed, then call manageSkill to create or improve one focused Dokploy skill. A skill must contain actionable Markdown instructions with: When to use, Procedure, Pitfalls, and Verification. Do not claim a skill was saved unless manageSkill succeeds.";
