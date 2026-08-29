import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import {
	findLibsqlById,
	findMariadbById,
	findMySqlById,
	findPostgresById,
	getRemoteDocker,
	waitForDatabaseServiceRunning,
} from "@dokploy/server";
import {
	checkServiceAccess,
	checkServicePermissionAndAccess,
} from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";
import {
	decodeDatabaseIdeMysqlField,
	parseDatabaseIdeCsv,
} from "@/server/api/utils/database-ide-output";
import {
	buildDatabaseUpdateStatement,
	type DatabaseIdeCellValue,
	quoteDatabaseIdentifier,
} from "@/server/api/utils/database-ide-query";

const databaseTypeSchema = z.enum(["postgres", "mysql", "mariadb", "libsql"]);
export type DatabaseIdeType = z.infer<typeof databaseTypeSchema>;

const databaseInputSchema = z.object({
	databaseId: z.string().min(1),
	databaseType: databaseTypeSchema,
});

const MAX_RESULT_ROWS = 500;
const MAX_SCHEMA_ROWS = 10_000;
const QUERY_TIMEOUT_MS = 30_000;

type CellValue = DatabaseIdeCellValue;

const cellValueSchema = z.union([
	z.string().max(100_000),
	z.number().finite(),
	z.boolean(),
	z.null(),
]);

interface QueryHeader {
	name: string;
	displayName: string;
	type: string;
}

interface QueryResult {
	headers: QueryHeader[];
	rows: Record<string, CellValue>[];
	rowsAffected: number;
	durationMs: number;
	command: string;
	truncated: boolean;
}

interface DatabaseServiceConnection {
	appName: string;
	databaseName: string;
	databasePassword: string;
	databaseUser: string;
	id: string;
	name: string;
	organizationId: string;
	serverId: string | null;
	status: "idle" | "running" | "done" | "error";
	type: DatabaseIdeType;
}

type DockerClient = Awaited<ReturnType<typeof getRemoteDocker>>;

const getDatabaseService = async (
	type: DatabaseIdeType,
	id: string,
): Promise<DatabaseServiceConnection> => {
	if (type === "postgres") {
		const service = await findPostgresById(id);
		return {
			appName: service.appName,
			databaseName: service.databaseName,
			databasePassword: service.databasePassword,
			databaseUser: service.databaseUser,
			id: service.postgresId,
			name: service.name,
			organizationId: service.environment.project.organizationId,
			serverId: service.serverId,
			status: service.applicationStatus,
			type,
		};
	}

	if (type === "mysql") {
		const service = await findMySqlById(id);
		return {
			appName: service.appName,
			databaseName: service.databaseName,
			databasePassword: service.databasePassword,
			databaseUser: service.databaseUser,
			id: service.mysqlId,
			name: service.name,
			organizationId: service.environment.project.organizationId,
			serverId: service.serverId,
			status: service.applicationStatus,
			type,
		};
	}

	if (type === "libsql") {
		const service = await findLibsqlById(id);
		return {
			appName: service.appName,
			databaseName: "main",
			databasePassword: service.databasePassword,
			databaseUser: service.databaseUser,
			id: service.libsqlId,
			name: service.name,
			organizationId: service.environment.project.organizationId,
			serverId: service.serverId,
			status: service.applicationStatus,
			type,
		};
	}

	const service = await findMariadbById(id);
	return {
		appName: service.appName,
		databaseName: service.databaseName,
		databasePassword: service.databasePassword,
		databaseUser: service.databaseUser,
		id: service.mariadbId,
		name: service.name,
		organizationId: service.environment.project.organizationId,
		serverId: service.serverId,
		status: service.applicationStatus,
		type,
	};
};

const assertOrganizationAccess = (
	service: DatabaseServiceConnection,
	organizationId: string,
) => {
	if (service.organizationId !== organizationId) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "You are not authorized to access this database",
		});
	}
};

const findRunningContainer = async (
	service: DatabaseServiceConnection,
	docker?: DockerClient,
) => {
	const client = docker ?? (await getRemoteDocker(service.serverId));
	try {
		return await waitForDatabaseServiceRunning(
			service.appName,
			service.serverId,
			{
				docker: client,
				requiredConsecutiveRunningChecks: 1,
				timeoutMs: 30_000,
			},
		);
	} catch (error) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				error instanceof Error
					? error.message
					: "The database container is not running",
		});
	}
};

interface ContainerCommandOptions {
	cmd: string[];
	env?: string[];
	input?: string;
}

const runContainerCommand = async (
	service: DatabaseServiceConnection,
	options: ContainerCommandOptions,
) => {
	const docker = await getRemoteDocker(service.serverId);
	const containerInfo = await findRunningContainer(service, docker);
	const exec = await docker.getContainer(containerInfo.Id).exec({
		AttachStderr: true,
		AttachStdin: options.input !== undefined,
		AttachStdout: true,
		Cmd: options.cmd,
		Env: options.env,
		Tty: false,
	});
	const stream = await exec.start({
		hijack: true,
		stdin: options.input !== undefined,
	});

	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	const stdout = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			stdoutChunks.push(Buffer.from(chunk));
			callback();
		},
	});
	const stderr = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			stderrChunks.push(Buffer.from(chunk));
			callback();
		},
	});
	docker.modem.demuxStream(stream, stdout, stderr);

	if (options.input !== undefined) stream.end(options.input);

	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			finished(stream),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					stream.destroy();
					reject(new Error("The database query timed out after 30 seconds"));
				}, QUERY_TIMEOUT_MS + 5_000);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}

	const result = await exec.inspect();
	const stdoutText = Buffer.concat(stdoutChunks).toString("utf8");
	const stderrText = Buffer.concat(stderrChunks).toString("utf8");
	if (result.ExitCode !== 0) {
		throw new Error(
			stderrText.trim() || stdoutText.trim() || "The database query failed",
		);
	}

	return { stdout: stdoutText, stderr: stderrText };
};

const uniqueHeaders = (
	headers: Array<{ displayName: string; type: string }>,
): QueryHeader[] => {
	const names = new Set<string>();
	return headers.map((header) => {
		let name = header.displayName;
		let suffix = 1;
		while (names.has(name)) {
			name = `${header.displayName}_${suffix}`;
			suffix += 1;
		}
		names.add(name);
		return { ...header, name };
	});
};

const ensureTerminatedStatement = (statement: string) => {
	const trimmed = statement.trim();
	return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
};

const commandFromStatement = (statement: string) =>
	/^\s*([a-z]+)/i.exec(statement)?.[1]?.toUpperCase() || "QUERY";

const assertNoNativeClientCommands = (
	statement: string,
	type: DatabaseIdeType,
) => {
	if (type === "libsql") return;
	if (/^\s*\\/m.test(statement)) {
		throw new Error(
			"Database client meta-commands are not supported in the IDE",
		);
	}
	if (
		type !== "postgres" &&
		/^\s*(delimiter|source|system|tee|notee|pager|nopager|edit|connect|quit|exit)\b/im.test(
			statement,
		)
	) {
		throw new Error("Database client commands are not supported in the IDE");
	}
};

const runPostgresQuery = async (
	service: DatabaseServiceConnection,
	statement: string,
	maxRows: number,
): Promise<QueryResult> => {
	const startedAt = performance.now();
	const marker = `__DOKPLOY_META_${randomBytes(16).toString("hex")}__`;
	const nullMarker = `__DOKPLOY_NULL_${randomBytes(16).toString("hex")}__`;
	const { stdout } = await runContainerCommand(service, {
		cmd: [
			"psql",
			"--no-psqlrc",
			"--csv",
			"--quiet",
			"--set",
			"ON_ERROR_STOP=1",
			`--pset=null=${nullMarker}`,
			"--username",
			service.databaseUser,
			"--dbname",
			service.databaseName,
		],
		env: [
			`PGPASSWORD=${service.databasePassword}`,
			`PGOPTIONS=-c statement_timeout=${QUERY_TIMEOUT_MS}`,
		],
		input: `${ensureTerminatedStatement(statement)}\n\\echo ${marker} :ROW_COUNT :SQLSTATE\n`,
	});

	const markerIndex = Math.max(
		stdout.lastIndexOf(`\n${marker} `),
		stdout.startsWith(`${marker} `) ? 0 : -1,
	);
	if (markerIndex < 0) {
		throw new Error("PostgreSQL did not return a complete query result");
	}
	const metadata = stdout
		.slice(markerIndex + (stdout[markerIndex] === "\n" ? 1 : 0))
		.trim()
		.split(/\s+/);
	const csv = stdout.slice(0, markerIndex).replace(/\n$/, "");
	const parsed = parseDatabaseIdeCsv(csv);
	const rawHeaders = parsed[0] ?? [];
	const headers = uniqueHeaders(
		rawHeaders.map((name, index) => ({
			displayName: name || `column_${index + 1}`,
			type: "text",
		})),
	);
	const rawRows = parsed.slice(1);
	const rows = rawRows
		.slice(0, maxRows)
		.map((row) =>
			Object.fromEntries(
				headers.map((header, index) => [
					header.name,
					row[index] === nullMarker ? null : (row[index] ?? null),
				]),
			),
		);

	const rowsAffected = Number(metadata[1]);
	return {
		headers,
		rows,
		rowsAffected: Number.isFinite(rowsAffected) ? rowsAffected : rows.length,
		durationMs: Math.round(performance.now() - startedAt),
		command: commandFromStatement(statement),
		truncated: rawRows.length > maxRows,
	};
};

const runMysqlQuery = async (
	service: DatabaseServiceConnection,
	statement: string,
	maxRows: number,
): Promise<QueryResult> => {
	const startedAt = performance.now();
	const marker = `__DOKPLOY_META_${randomBytes(16).toString("hex")}__`;
	const timeoutStatement =
		service.type === "mariadb"
			? `SET SESSION max_statement_time=${QUERY_TIMEOUT_MS / 1000};`
			: `SET SESSION MAX_EXECUTION_TIME=${QUERY_TIMEOUT_MS};`;
	const { stdout } = await runContainerCommand(service, {
		cmd: [
			service.type === "mariadb" ? "mariadb" : "mysql",
			"--batch",
			"--binary-mode",
			...(service.type === "mysql" ? ["--binary-as-hex"] : []),
			"--connect-timeout=10",
			"--default-character-set=utf8mb4",
			"--quick",
			`--user=${service.databaseUser}`,
			`--database=${service.databaseName}`,
		],
		env: [`MYSQL_PWD=${service.databasePassword}`],
		input: `${timeoutStatement}\n${ensureTerminatedStatement(statement)}\nSELECT '${marker}' AS __dokploy_meta__, ROW_COUNT() AS affected_rows;\n`,
	});

	const lines = stdout.replaceAll("\r\n", "\n").trimEnd().split("\n");
	let markerIndex = -1;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (lines[index]?.startsWith(`${marker}\t`)) {
			markerIndex = index;
			break;
		}
	}
	if (markerIndex < 1) {
		throw new Error("MySQL did not return a complete query result");
	}
	const metadata = lines[markerIndex]?.split("\t") ?? [];
	const resultLines = lines.slice(0, markerIndex - 1);
	const rawHeaders = resultLines[0]?.split("\t") ?? [];
	const headers = uniqueHeaders(
		rawHeaders.map((name, index) => ({
			displayName: String(
				decodeDatabaseIdeMysqlField(name) ?? `column_${index + 1}`,
			),
			type: "text",
		})),
	);
	const rawRows = resultLines.slice(1).map((line) => line.split("\t"));
	const rows = rawRows
		.slice(0, maxRows)
		.map((row) =>
			Object.fromEntries(
				headers.map((header, index) => [
					header.name,
					decodeDatabaseIdeMysqlField(row[index]),
				]),
			),
		);

	const rowsAffected = Number(decodeDatabaseIdeMysqlField(metadata[1]));
	return {
		headers,
		rows,
		rowsAffected: Number.isFinite(rowsAffected) ? rowsAffected : rows.length,
		durationMs: Math.round(performance.now() - startedAt),
		command: commandFromStatement(statement),
		truncated: rawRows.length > maxRows,
	};
};

interface LibsqlValue {
	base64?: string;
	type: "null" | "integer" | "float" | "text" | "blob";
	value?: number | string;
}

interface LibsqlStatementResult {
	affected_row_count?: number;
	cols?: Array<{ name: string | null }>;
	rows?: LibsqlValue[][];
}

const LIBSQL_HTTP_COMMAND = [
	"set -e",
	"body=$(cat)",
	"exec 3<>/dev/tcp/127.0.0.1/8080",
	'printf \'POST /v1/execute HTTP/1.0\\r\\nHost: 127.0.0.1:8080\\r\\nAuthorization: Basic %s\\r\\nContent-Type: application/json\\r\\nContent-Length: %s\\r\\nConnection: close\\r\\n\\r\\n\' "$DOKPLOY_BASIC_AUTH" "${#body}" >&3',
	"printf '%s' \"$body\" >&3",
	"cat <&3",
].join("\n");

const fromLibsqlValue = (value: LibsqlValue | undefined): CellValue => {
	if (!value || value.type === "null") return null;
	if (value.type === "float") return Number(value.value);
	if (value.type === "integer") {
		const integer = String(value.value ?? "0");
		const parsed = Number(integer);
		return Number.isSafeInteger(parsed) ? parsed : integer;
	}
	if (value.type === "blob") {
		return `\\x${Buffer.from(value.base64 ?? "", "base64").toString("hex")}`;
	}
	return String(value.value ?? "");
};

const runLibsqlQuery = async (
	service: DatabaseServiceConnection,
	statement: string,
	maxRows: number,
): Promise<QueryResult> => {
	const startedAt = performance.now();
	const { stdout } = await runContainerCommand(service, {
		cmd: ["bash", "-c", LIBSQL_HTTP_COMMAND],
		env: [
			`DOKPLOY_BASIC_AUTH=${Buffer.from(
				`${service.databaseUser}:${service.databasePassword}`,
			).toString("base64")}`,
			"LC_ALL=C",
		],
		input: JSON.stringify({ stmt: { sql: statement, want_rows: true } }),
	});
	const headerEnd = stdout.indexOf("\r\n\r\n");
	if (headerEnd < 0) {
		throw new Error("LibSQL did not return a complete HTTP response");
	}
	const statusLine = stdout.slice(0, stdout.indexOf("\r\n"));
	const statusCode = Number(statusLine.split(" ")[1]);
	const body = JSON.parse(stdout.slice(headerEnd + 4)) as {
		message?: string;
		result?: LibsqlStatementResult;
	};
	if (statusCode < 200 || statusCode >= 300 || !body.result) {
		throw new Error(body.message || `LibSQL returned HTTP ${statusCode}`);
	}

	const rawRows = body.result.rows ?? [];
	const headers = uniqueHeaders(
		(body.result.cols ?? []).map((column, index) => ({
			displayName: column.name || `column_${index + 1}`,
			type: "sqlite",
		})),
	);
	const rows = rawRows
		.slice(0, maxRows)
		.map((row) =>
			Object.fromEntries(
				headers.map((header, index) => [
					header.name,
					fromLibsqlValue(row[index]),
				]),
			),
		);

	return {
		headers,
		rows,
		rowsAffected: body.result.affected_row_count ?? rows.length,
		durationMs: Math.round(performance.now() - startedAt),
		command: commandFromStatement(statement),
		truncated: rawRows.length > maxRows,
	};
};

const runDatabaseQuery = async (
	service: DatabaseServiceConnection,
	statement: string,
	maxRows = MAX_RESULT_ROWS,
): Promise<QueryResult> => {
	assertNoNativeClientCommands(statement, service.type);
	if (service.type === "postgres") {
		return runPostgresQuery(service, statement, maxRows);
	}
	if (service.type !== "libsql") {
		return runMysqlQuery(service, statement, maxRows);
	}

	return runLibsqlQuery(service, statement, maxRows);
};

const schemaStatement = (type: DatabaseIdeType) => {
	if (type === "postgres") {
		return `
			SELECT
				t.table_schema AS "schema",
				t.table_name AS "table",
				t.table_type AS "kind",
				c.column_name AS "column",
				c.data_type AS "dataType",
				(c.is_nullable = 'YES') AS "nullable",
				c.column_default AS "defaultValue",
				EXISTS (
					SELECT 1
					FROM information_schema.table_constraints tc
					JOIN information_schema.key_column_usage kcu
						ON kcu.constraint_catalog = tc.constraint_catalog
						AND kcu.constraint_schema = tc.constraint_schema
						AND kcu.constraint_name = tc.constraint_name
					WHERE tc.constraint_type = 'PRIMARY KEY'
						AND kcu.table_schema = t.table_schema
						AND kcu.table_name = t.table_name
						AND kcu.column_name = c.column_name
				) AS "primaryKey",
				(c.is_generated = 'NEVER' AND c.is_identity = 'NO') AS "editable"
			FROM information_schema.tables t
			LEFT JOIN information_schema.columns c
				ON c.table_schema = t.table_schema
				AND c.table_name = t.table_name
			WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
			ORDER BY t.table_schema, t.table_name, c.ordinal_position
		`;
	}

	if (type === "libsql") {
		return `
			SELECT
				'main' AS "schema",
				m.name AS "table",
				CASE m.type WHEN 'view' THEN 'VIEW' ELSE 'TABLE' END AS "kind",
				p.name AS "column",
				COALESCE(p.type, '') AS "dataType",
				(p."notnull" = 0) AS "nullable",
				p.dflt_value AS "defaultValue",
				(COALESCE(p.pk, 0) > 0) AS "primaryKey",
				(COALESCE(p.hidden, 0) = 0) AS "editable"
			FROM sqlite_schema m
			LEFT JOIN pragma_table_xinfo(m.name) p ON true
			WHERE m.type IN ('table', 'view')
				AND m.name NOT LIKE 'sqlite_%'
			ORDER BY m.name, p.cid
		`;
	}

	return `
			SELECT
				t.TABLE_SCHEMA AS \`schema\`,
				t.TABLE_NAME AS \`table\`,
				t.TABLE_TYPE AS \`kind\`,
				c.COLUMN_NAME AS \`column\`,
				c.DATA_TYPE AS \`dataType\`,
				(c.IS_NULLABLE = 'YES') AS \`nullable\`,
				c.COLUMN_DEFAULT AS \`defaultValue\`,
				(c.COLUMN_KEY = 'PRI') AS \`primaryKey\`,
				(c.EXTRA NOT LIKE '%GENERATED%' AND c.EXTRA NOT LIKE '%auto_increment%') AS \`editable\`
			FROM information_schema.TABLES t
			LEFT JOIN information_schema.COLUMNS c
				ON c.TABLE_SCHEMA = t.TABLE_SCHEMA
				AND c.TABLE_NAME = t.TABLE_NAME
			WHERE t.TABLE_SCHEMA = DATABASE()
			ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME, c.ORDINAL_POSITION
		`;
};

const loadSchema = async (service: DatabaseServiceConnection) => {
	const result = await runDatabaseQuery(
		service,
		schemaStatement(service.type),
		MAX_SCHEMA_ROWS,
	);
	const tables = new Map<
		string,
		{
			columns: Array<{
				dataType: string;
				defaultValue: CellValue;
				editable: boolean;
				name: string;
				nullable: boolean;
				primaryKey: boolean;
			}>;
			kind: string;
			name: string;
			schema: string;
		}
	>();

	for (const row of result.rows) {
		const schema = String(row.schema ?? "");
		const name = String(row.table ?? "");
		const key = `${schema}\u0000${name}`;
		let table = tables.get(key);
		if (!table) {
			table = {
				columns: [],
				kind: String(row.kind ?? "TABLE"),
				name,
				schema,
			};
			tables.set(key, table);
		}

		if (row.column) {
			table.columns.push({
				dataType: String(row.dataType ?? "unknown"),
				defaultValue: row.defaultValue ?? null,
				editable:
					row.editable === true ||
					row.editable === 1 ||
					row.editable === "1" ||
					row.editable === "t" ||
					row.editable === "true",
				name: String(row.column),
				nullable:
					row.nullable === true ||
					row.nullable === 1 ||
					row.nullable === "1" ||
					row.nullable === "t" ||
					row.nullable === "true",
				primaryKey:
					row.primaryKey === true ||
					row.primaryKey === 1 ||
					row.primaryKey === "1" ||
					row.primaryKey === "t" ||
					row.primaryKey === "true",
			});
		}
	}

	return {
		databaseName: service.databaseName,
		tables: [...tables.values()],
	};
};

const handleDatabaseError = (error: unknown): never => {
	if (error instanceof TRPCError) throw error;
	throw new TRPCError({
		code: "BAD_REQUEST",
		message:
			error instanceof Error ? error.message : "The database query failed",
		cause: error,
	});
};

export const databaseIdeRouter = createTRPCRouter({
	schema: protectedProcedure
		.input(databaseInputSchema)
		.query(async ({ input, ctx }) => {
			try {
				await checkServiceAccess(ctx, input.databaseId, "read");
				const service = await getDatabaseService(
					input.databaseType,
					input.databaseId,
				);
				assertOrganizationAccess(service, ctx.session.activeOrganizationId);
				return await loadSchema(service);
			} catch (error) {
				return handleDatabaseError(error);
			}
		}),

	previewTable: protectedProcedure
		.input(
			databaseInputSchema.extend({
				schema: z.string().min(1).max(128),
				table: z.string().min(1).max(128),
				limit: z.number().int().min(1).max(MAX_RESULT_ROWS).default(100),
			}),
		)
		.query(async ({ input, ctx }) => {
			try {
				await checkServiceAccess(ctx, input.databaseId, "read");
				const service = await getDatabaseService(
					input.databaseType,
					input.databaseId,
				);
				assertOrganizationAccess(service, ctx.session.activeOrganizationId);

				const statement = `SELECT * FROM ${quoteDatabaseIdentifier(service.type, input.schema)}.${quoteDatabaseIdentifier(service.type, input.table)} LIMIT ${input.limit}`;
				return await runDatabaseQuery(service, statement);
			} catch (error) {
				return handleDatabaseError(error);
			}
		}),

	updateRow: protectedProcedure
		.input(
			databaseInputSchema.extend({
				schema: z.string().min(1).max(128),
				table: z.string().min(1).max(128),
				primaryKey: z.record(z.string().min(1).max(128), cellValueSchema),
				changes: z.record(z.string().min(1).max(128), cellValueSchema),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			try {
				await checkServicePermissionAndAccess(ctx, input.databaseId, {
					service: ["create"],
				});
				const service = await getDatabaseService(
					input.databaseType,
					input.databaseId,
				);
				assertOrganizationAccess(service, ctx.session.activeOrganizationId);

				const schema = await loadSchema(service);
				const table = schema.tables.find(
					(candidate) =>
						candidate.schema === input.schema && candidate.name === input.table,
				);
				if (!table || table.kind.includes("VIEW")) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Only database tables can be edited",
					});
				}

				const primaryKeyColumns = table.columns.filter(
					(column) => column.primaryKey,
				);
				if (primaryKeyColumns.length === 0) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message:
							"This table needs a primary key before rows can be edited safely",
					});
				}
				if (
					Object.keys(input.primaryKey).length !== primaryKeyColumns.length ||
					!primaryKeyColumns.every((column) =>
						Object.hasOwn(input.primaryKey, column.name),
					)
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "The row primary key is incomplete",
					});
				}
				if (Object.values(input.primaryKey).some((value) => value === null)) {
					throw new TRPCError({
						code: "PRECONDITION_FAILED",
						message: "Rows with an empty primary key cannot be edited safely",
					});
				}

				const changes = Object.entries(input.changes);
				if (changes.length === 0 || changes.length > table.columns.length) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Select at least one valid column to update",
					});
				}
				for (const [columnName] of changes) {
					const column = table.columns.find(
						(candidate) => candidate.name === columnName,
					);
					if (!column?.editable || column.primaryKey) {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `Column "${columnName}" cannot be edited`,
						});
					}
				}

				const statement = buildDatabaseUpdateStatement({
					type: service.type,
					schema: table.schema,
					table: table.name,
					primaryKey: input.primaryKey,
					changes: input.changes,
				});
				const result = await runDatabaseQuery(service, statement);

				await audit(ctx, {
					action: "update",
					resourceType: "service",
					resourceId: service.id,
					resourceName: service.appName,
					metadata: {
						databaseType: service.type,
						source: "database-ide-row-editor",
						schema: table.schema,
						table: table.name,
						columns: changes.map(([column]) => column),
					},
				});

				return result;
			} catch (error) {
				return handleDatabaseError(error);
			}
		}),

	execute: protectedProcedure
		.input(
			databaseInputSchema.extend({
				statement: z.string().trim().min(1).max(50_000),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			try {
				await checkServicePermissionAndAccess(ctx, input.databaseId, {
					service: ["create"],
				});
				const service = await getDatabaseService(
					input.databaseType,
					input.databaseId,
				);
				assertOrganizationAccess(service, ctx.session.activeOrganizationId);
				const result = await runDatabaseQuery(service, input.statement);

				await audit(ctx, {
					action: "run",
					resourceType: "service",
					resourceId: service.id,
					resourceName: service.appName,
					metadata: { databaseType: service.type, source: "database-ide" },
				});

				return result;
			} catch (error) {
				return handleDatabaseError(error);
			}
		}),
});
