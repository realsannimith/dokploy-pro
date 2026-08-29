import { describe, expect, it } from "vitest";
import { deriveDatabaseApplicationStatus } from "@/server/api/utils/database-runtime";

describe("database runtime status", () => {
	it("uses live running state even when the stored deployment state is stale", () => {
		expect(deriveDatabaseApplicationStatus("error", "running")).toBe("done");
	});

	it("shows a prepared task as starting instead of done", () => {
		expect(deriveDatabaseApplicationStatus("done", "starting")).toBe("running");
	});

	it("shows a failed or unexpectedly stopped task as an error", () => {
		expect(deriveDatabaseApplicationStatus("done", "failed")).toBe("error");
		expect(deriveDatabaseApplicationStatus("done", "stopped")).toBe("error");
	});

	it("preserves an intentional idle state when Docker reports stopped", () => {
		expect(deriveDatabaseApplicationStatus("idle", "stopped")).toBe("idle");
	});

	it("does not show stored done as healthy when Docker cannot be inspected", () => {
		expect(deriveDatabaseApplicationStatus("done", "unknown")).toBe("running");
		expect(deriveDatabaseApplicationStatus("idle", "unknown")).toBe("idle");
	});
});
