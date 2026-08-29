import { describe, expect, it } from "vitest";
import { isAllowed, parseAllowlist } from "@/server/agent/access";

describe("parseAllowlist", () => {
	it("parses comma separated ids", () => {
		expect(parseAllowlist("123, 456")).toEqual(["123", "456"]);
	});

	it("strips @ prefixes and lowercases usernames", () => {
		expect(parseAllowlist("@JohnDoe, 42")).toEqual(["johndoe", "42"]);
	});

	it("handles whitespace and newline separators", () => {
		expect(parseAllowlist("1\n2 3,4")).toEqual(["1", "2", "3", "4"]);
	});

	it("returns empty list for empty or null input", () => {
		expect(parseAllowlist("")).toEqual([]);
		expect(parseAllowlist(null)).toEqual([]);
		expect(parseAllowlist(undefined)).toEqual([]);
	});
});

describe("isAllowed", () => {
	it("denies everyone when the allowlist is empty", () => {
		expect(isAllowed([], { id: 123 })).toBe(false);
	});

	it("denies when the sender is missing", () => {
		expect(isAllowed(["123"], undefined)).toBe(false);
	});

	it("allows by numeric id", () => {
		expect(isAllowed(parseAllowlist("123,456"), { id: 456 })).toBe(true);
		expect(isAllowed(parseAllowlist("123,456"), { id: 789 })).toBe(false);
	});

	it("allows by username case-insensitively", () => {
		const allowlist = parseAllowlist("@JohnDoe");
		expect(isAllowed(allowlist, { id: 1, username: "johndoe" })).toBe(true);
		expect(isAllowed(allowlist, { id: 1, username: "JohnDoe" })).toBe(true);
		expect(isAllowed(allowlist, { id: 1, username: "other" })).toBe(false);
	});

	it("does not allow a user whose id matches someone else's username", () => {
		expect(isAllowed(parseAllowlist("@123"), { id: 999, username: "123" })).toBe(
			true,
		);
		expect(isAllowed(parseAllowlist("@abc"), { id: 999 })).toBe(false);
	});
});
