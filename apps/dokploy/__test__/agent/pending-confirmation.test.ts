import { describe, expect, it, vi } from "vitest";
import { buildAgentTools } from "@/server/agent/tools";

const deleteCaller = () => ({
	postgres: {
		one: vi.fn().mockResolvedValue({ name: "cache-db" }),
		remove: vi.fn().mockResolvedValue({}),
	},
});

describe("destructive tool approval gate", () => {
	it("asks for approval instead of deleting when a handler is present", async () => {
		const caller = deleteCaller();
		const request = vi.fn().mockResolvedValue("CONFIRMATION SENT");
		const tools = buildAgentTools(caller as never, {
			agentId: "agent-1",
			confirmation: { request },
		});

		const result = await (tools.deleteService as any).execute({
			serviceType: "postgres",
			serviceId: "postgres-1",
			confirmName: "cache-db",
			deleteVolumes: false,
		});

		expect(result).toBe("CONFIRMATION SENT");
		expect(caller.postgres.remove).not.toHaveBeenCalled();
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ toolName: "deleteService" }),
		);
	});

	it("refuses on surfaces that cannot collect an approval", async () => {
		const caller = deleteCaller();
		const tools = buildAgentTools(caller as never, { agentId: "agent-1" });

		const result = await (tools.deleteService as any).execute({
			serviceType: "postgres",
			serviceId: "postgres-1",
			confirmName: "cache-db",
			deleteVolumes: false,
		});

		expect(result).toContain("requires user approval");
		expect(caller.postgres.remove).not.toHaveBeenCalled();
	});

	it("really deletes when replaying an already approved call", async () => {
		const caller = deleteCaller();
		const tools = buildAgentTools(caller as never, {
			agentId: "agent-1",
			skipConfirmation: true,
		});

		const result = await (tools.deleteService as any).execute({
			serviceType: "postgres",
			serviceId: "postgres-1",
			confirmName: "cache-db",
			deleteVolumes: false,
		});

		expect(caller.postgres.remove).toHaveBeenCalledWith({
			postgresId: "postgres-1",
		});
		expect(result).toContain('Service "cache-db" deleted.');
	});
});
