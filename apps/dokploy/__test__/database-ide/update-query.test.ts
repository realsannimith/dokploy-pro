import { describe, expect, it } from "vitest";
import {
	buildDatabaseUpdateStatement,
	quoteDatabaseIdentifier,
} from "@/server/api/utils/database-ide-query";

describe("database IDE update queries", () => {
	it("quotes PostgreSQL identifiers and values", () => {
		expect(
			buildDatabaseUpdateStatement({
				type: "postgres",
				schema: "public",
				table: "user accounts",
				primaryKey: { id: 42 },
				changes: { active: true, name: "O'Reilly", nickname: null },
			}),
		).toBe(
			`UPDATE "public"."user accounts" SET "active" = TRUE, "name" = $dokploy$O'Reilly$dokploy$, "nickname" = NULL WHERE "id" = 42;`,
		);
	});

	it("supports composite keys for MySQL and MariaDB", () => {
		expect(
			buildDatabaseUpdateStatement({
				type: "mysql",
				schema: "workspace",
				table: "members",
				primaryKey: { organization_id: "org_1", user_id: "user_1" },
				changes: { role: "admin" },
			}),
		).toBe(
			"UPDATE `workspace`.`members` SET `role` = CONVERT(UNHEX('61646d696e') USING utf8mb4) WHERE `organization_id` = CONVERT(UNHEX('6f72675f31') USING utf8mb4) AND `user_id` = CONVERT(UNHEX('757365725f31') USING utf8mb4);",
		);
	});

	it("encodes string values without placing user text in SQL", () => {
		const statement = buildDatabaseUpdateStatement({
			type: "mariadb",
			schema: "workspace",
			table: "members",
			primaryKey: { id: 1 },
			changes: { role: "\\'; DROP TABLE members; --" },
		});

		expect(statement).not.toContain("DROP TABLE");
		expect(statement).toContain("CONVERT(UNHEX(");
	});

	it("changes the PostgreSQL delimiter if it appears in a value", () => {
		const statement = buildDatabaseUpdateStatement({
			type: "postgres",
			schema: "public",
			table: "notes",
			primaryKey: { id: "note-1" },
			changes: { body: "contains $dokploy$ inside" },
		});

		expect(statement).toContain(
			"$dokploy1$contains $dokploy$ inside$dokploy1$",
		);
	});

	it("escapes identifier delimiters", () => {
		expect(quoteDatabaseIdentifier("postgres", 'a"b')).toBe('"a""b"');
		expect(quoteDatabaseIdentifier("mariadb", "a`b")).toBe("`a``b`");
	});

	it("rejects unsafe or incomplete values", () => {
		expect(() =>
			buildDatabaseUpdateStatement({
				type: "libsql",
				schema: "main",
				table: "users",
				primaryKey: {},
				changes: { name: "Ada" },
			}),
		).toThrow("primary key");

		expect(() =>
			buildDatabaseUpdateStatement({
				type: "postgres",
				schema: "public",
				table: "users",
				primaryKey: { id: 1 },
				changes: { name: "bad\0value" },
			}),
		).toThrow("null bytes");

		expect(() =>
			buildDatabaseUpdateStatement({
				type: "libsql",
				schema: "main",
				table: "users",
				primaryKey: { id: null },
				changes: { name: "Ada" },
			}),
		).toThrow("Primary key values cannot be null");
	});
});
