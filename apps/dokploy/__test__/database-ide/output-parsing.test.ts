import { describe, expect, it } from "vitest";
import {
	decodeDatabaseIdeMysqlField,
	parseDatabaseIdeCsv,
} from "@/server/api/utils/database-ide-output";

describe("database IDE output parsing", () => {
	it("parses PostgreSQL CSV with commas, escaped quotes and newlines", () => {
		expect(
			parseDatabaseIdeCsv(
				'id,name,note\n1,"Doe, Jane","line 1\nline 2"\n2,"a ""quote""",ok',
			),
		).toEqual([
			["id", "name", "note"],
			["1", "Doe, Jane", "line 1\nline 2"],
			["2", 'a "quote"', "ok"],
		]);
	});

	it("preserves empty PostgreSQL fields", () => {
		expect(parseDatabaseIdeCsv("a,b,c\n,hello,")).toEqual([
			["a", "b", "c"],
			["", "hello", ""],
		]);
	});

	it("decodes MySQL batch escapes and nulls", () => {
		expect(decodeDatabaseIdeMysqlField("line\\nvalue\\tend\\\\path")).toBe(
			"line\nvalue\tend\\path",
		);
		expect(decodeDatabaseIdeMysqlField("NULL")).toBeNull();
		expect(decodeDatabaseIdeMysqlField(undefined)).toBeNull();
	});
});
