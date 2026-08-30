import { agentConversation } from "@dokploy/server/db/schema";
import { deleteConversationsByAgentId } from "@dokploy/server/services/agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
	delete: vi.fn(),
	where: vi.fn(),
	returning: vi.fn(),
}));
const drizzle = vi.hoisted(() => ({
	eq: vi.fn(),
}));

vi.mock("@dokploy/server/db", () => ({
	db: {
		delete: database.delete,
	},
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
	...(await importOriginal<typeof import("drizzle-orm")>()),
	eq: drizzle.eq,
}));

describe("AI agent chat history", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		database.delete.mockReturnValue({ where: database.where });
		database.where.mockReturnValue({ returning: database.returning });
		drizzle.eq.mockReturnValue("agent-filter");
	});

	it("deletes every conversation owned by the selected agent", async () => {
		database.returning.mockResolvedValue([
			{ conversationId: "conversation-1" },
			{ conversationId: "conversation-2" },
		]);

		await expect(deleteConversationsByAgentId("agent-1")).resolves.toBe(2);

		expect(database.delete).toHaveBeenCalledWith(agentConversation);
		expect(drizzle.eq).toHaveBeenCalledWith(
			agentConversation.agentId,
			"agent-1",
		);
		expect(database.where).toHaveBeenCalledWith("agent-filter");
		expect(database.returning).toHaveBeenCalledWith({
			conversationId: agentConversation.conversationId,
		});
	});

	it("reports zero when the agent has no chat history", async () => {
		database.returning.mockResolvedValue([]);

		await expect(deleteConversationsByAgentId("agent-1")).resolves.toBe(0);
	});
});
