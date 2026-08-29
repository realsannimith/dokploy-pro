export type DatabaseIdeQueryType = "postgres" | "mysql" | "mariadb" | "libsql";

export type DatabaseIdeCellValue = string | number | boolean | null;

export const quoteDatabaseIdentifier = (
	type: DatabaseIdeQueryType,
	identifier: string,
) =>
	type === "postgres" || type === "libsql"
		? `"${identifier.replaceAll('"', '""')}"`
		: `\`${identifier.replaceAll("`", "``")}\``;

const databaseValueLiteral = (
	type: DatabaseIdeQueryType,
	value: DatabaseIdeCellValue,
) => {
	if (value === null) return "NULL";
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("Database values must be finite numbers");
		}
		return String(value);
	}
	if (value.includes("\0")) {
		throw new Error("Database values cannot contain null bytes");
	}

	if (type === "postgres") {
		let suffix = "";
		let delimiter = "$dokploy$";
		while (value.includes(delimiter)) {
			suffix = suffix ? String(Number(suffix) + 1) : "1";
			delimiter = `$dokploy${suffix}$`;
		}
		return `${delimiter}${value}${delimiter}`;
	}

	const hex = Buffer.from(value, "utf8").toString("hex");
	if (type === "libsql") {
		return `CAST(X'${hex}' AS TEXT)`;
	}
	return `CONVERT(UNHEX('${hex}') USING utf8mb4)`;
};

interface UpdateStatementInput {
	type: DatabaseIdeQueryType;
	schema: string;
	table: string;
	primaryKey: Record<string, DatabaseIdeCellValue>;
	changes: Record<string, DatabaseIdeCellValue>;
}

export const buildDatabaseUpdateStatement = ({
	type,
	schema,
	table,
	primaryKey,
	changes,
}: UpdateStatementInput) => {
	const changeEntries = Object.entries(changes);
	const primaryKeyEntries = Object.entries(primaryKey);
	if (changeEntries.length === 0) {
		throw new Error("Select at least one value to update");
	}
	if (primaryKeyEntries.length === 0) {
		throw new Error("A primary key is required to update a row safely");
	}

	const target = `${quoteDatabaseIdentifier(type, schema)}.${quoteDatabaseIdentifier(type, table)}`;
	const assignments = changeEntries
		.map(
			([column, value]) =>
				`${quoteDatabaseIdentifier(type, column)} = ${databaseValueLiteral(type, value)}`,
		)
		.join(", ");
	const conditions = primaryKeyEntries
		.map(([column, value]) => {
			if (value === null) {
				throw new Error("Primary key values cannot be null");
			}
			const identifier = quoteDatabaseIdentifier(type, column);
			return `${identifier} = ${databaseValueLiteral(type, value)}`;
		})
		.join(" AND ");

	return `UPDATE ${target} SET ${assignments} WHERE ${conditions};`;
};
