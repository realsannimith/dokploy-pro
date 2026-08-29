import { createServer, type Server as NetServer, type Socket } from "node:net";
import {
	findLibsqlById,
	findMariadbById,
	findMySqlById,
	findPostgresById,
	findServerById,
	getServiceContainer,
} from "@dokploy/server";
import {
	checkServiceAccess,
	checkServicePermissionAndAccess,
} from "@dokploy/server/services/permission";
import { TRPCError } from "@trpc/server";
import type { FieldPacket, ResultSetHeader } from "mysql2";
import mysql from "mysql2/promise";
import postgres from "postgres";
import { Client } from "ssh2";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { audit } from "@/server/api/utils/audit";

const databaseTypeSchema = z.enum(["postgres", "mysql", "mariadb", "libsql"]);
export type DatabaseIdeType = z.infer<typeof databaseTypeSchema>;

const databaseInputSchema = z.object({
	databaseId: z.string().min(1),
	databaseType: databaseTypeSchema,
});

const MAX_RESULT_ROWS = 500;
const MAX_SCHEMA_ROWS = 10_000;
const QUERY_TIMEOUT_MS = 30_000;

type CellValue = string | number | boolean | null;

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

interface ConnectionTarget {
	close: () => Promise<void>;
	host: string;
	port: number;
}

const noOpClose = async () => {};

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

const findContainerAddress = async (service: DatabaseServiceConnection) => {
	if (service.status !== "done") {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "Deploy and start the database before opening the IDE",
		});
	}

	const container = await getServiceContainer(
		service.appName,
		service.serverId,
	);
	if (!container) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "The database container is not running",
		});
	}

	const networks = container.NetworkSettings?.Networks ?? {};
	const preferredNetwork = networks["dokploy-network"];
	const address =
		preferredNetwork?.IPAddress ||
		Object.values(networks).find((network) => network.IPAddress)?.IPAddress;

	if (!address) {
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Could not resolve the private database address",
		});
	}

	return address;
};

const createSshTunnel = async (
	serverId: string,
	targetHost: string,
	targetPort: number,
): Promise<ConnectionTarget> => {
	const server = await findServerById(serverId);
	if (!server.sshKey?.privateKey) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: "The remote server does not have an SSH key configured",
		});
	}

	const client = new Client();
	await new Promise<void>((resolve, reject) => {
		client.once("ready", resolve).once("error", reject).connect({
			host: server.ipAddress,
			port: server.port,
			username: server.username,
			privateKey: server.sshKey?.privateKey,
			readyTimeout: 15_000,
		});
	});

	const sockets = new Set<Socket>();
	const tunnel = createServer((socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));

		client.forwardOut(
			"127.0.0.1",
			0,
			targetHost,
			targetPort,
			(error, stream) => {
				if (error) {
					socket.destroy(error);
					return;
				}
				socket.pipe(stream).pipe(socket);
			},
		);
	});

	try {
		await new Promise<void>((resolve, reject) => {
			tunnel.once("error", reject);
			tunnel.listen(0, "127.0.0.1", () => {
				tunnel.removeListener("error", reject);
				resolve();
			});
		});
	} catch (error) {
		client.end();
		throw error;
	}

	const address = tunnel.address();
	if (!address || typeof address === "string") {
		await closeTunnel(tunnel, client, sockets);
		throw new TRPCError({
			code: "INTERNAL_SERVER_ERROR",
			message: "Could not create a secure database tunnel",
		});
	}

	return {
		host: "127.0.0.1",
		port: address.port,
		close: () => closeTunnel(tunnel, client, sockets),
	};
};

const closeTunnel = async (
	tunnel: NetServer,
	client: Client,
	sockets: Set<Socket>,
) => {
	for (const socket of sockets) socket.destroy();
	await new Promise<void>((resolve) => tunnel.close(() => resolve()));
	client.end();
};

const getConnectionTarget = async (
	service: DatabaseServiceConnection,
): Promise<ConnectionTarget> => {
	const host = await findContainerAddress(service);
	const port =
		service.type === "postgres"
			? 5432
			: service.type === "libsql"
				? 8080
				: 3306;

	if (service.serverId) {
		return createSshTunnel(service.serverId, host, port);
	}

	return { host, port, close: noOpClose };
};

const toCellValue = (value: unknown): CellValue => {
	if (value === null || value === undefined) return null;
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "bigint") return value.toString();
	if (value instanceof Date) return value.toISOString();
	if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;

	try {
		const serialized = JSON.stringify(value, (_key, nestedValue) =>
			typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
		);
		return serialized ?? String(value);
	} catch {
		return String(value);
	}
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

const runPostgresQuery = async (
	service: DatabaseServiceConnection,
	target: ConnectionTarget,
	statement: string,
	maxRows: number,
): Promise<QueryResult> => {
	const startedAt = performance.now();
	const sql = postgres({
		host: target.host,
		port: target.port,
		database: service.databaseName,
		username: service.databaseUser,
		password: service.databasePassword,
		max: 1,
		connect_timeout: 10,
		idle_timeout: 5,
		prepare: false,
		onnotice: () => {},
	});

	try {
		await sql`select set_config('statement_timeout', ${String(QUERY_TIMEOUT_MS)}, false)`;
		const result = await sql.unsafe(statement).values();
		const truncated = result.length > maxRows;
		const rawRows = result.slice(0, maxRows);
		const headers = uniqueHeaders(
			result.columns.map((column) => ({
				displayName: column.name,
				type: String(column.type),
			})),
		);
		const rows = rawRows.map((row) =>
			Object.fromEntries(
				headers.map((header, index) => [header.name, toCellValue(row[index])]),
			),
		);

		return {
			headers,
			rows,
			rowsAffected: result.count ?? rows.length,
			durationMs: Math.round(performance.now() - startedAt),
			command: result.command || "QUERY",
			truncated,
		};
	} finally {
		await sql.end({ timeout: 2 });
	}
};

const runMysqlQuery = async (
	service: DatabaseServiceConnection,
	target: ConnectionTarget,
	statement: string,
	maxRows: number,
): Promise<QueryResult> => {
	const startedAt = performance.now();
	const connection = await mysql.createConnection({
		host: target.host,
		port: target.port,
		database: service.databaseName,
		user: service.databaseUser,
		password: service.databasePassword,
		connectTimeout: 10_000,
		dateStrings: true,
		rowsAsArray: true,
		supportBigNumbers: true,
		bigNumberStrings: true,
	});

	try {
		await connection.query("SET SESSION SQL_SELECT_LIMIT = ?", [maxRows + 1]);
		const [rawRows, fields] = await connection.query({
			sql: statement,
			timeout: QUERY_TIMEOUT_MS,
			rowsAsArray: true,
		});

		if (!Array.isArray(rawRows)) {
			const result = rawRows as ResultSetHeader;
			return {
				headers: [],
				rows: [],
				rowsAffected: result.affectedRows ?? 0,
				durationMs: Math.round(performance.now() - startedAt),
				command: "QUERY",
				truncated: false,
			};
		}

		const headers = uniqueHeaders(
			(fields as FieldPacket[]).map((field) => ({
				displayName: field.name,
				type: String(field.type),
			})),
		);
		const truncated = rawRows.length > maxRows;
		const rows = (rawRows as unknown[][])
			.slice(0, maxRows)
			.map((row) =>
				Object.fromEntries(
					headers.map((header, index) => [
						header.name,
						toCellValue(row[index]),
					]),
				),
			);

		return {
			headers,
			rows,
			rowsAffected: rows.length,
			durationMs: Math.round(performance.now() - startedAt),
			command: "SELECT",
			truncated,
		};
	} finally {
		await connection.end();
	}
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
	target: ConnectionTarget,
	statement: string,
	maxRows: number,
): Promise<QueryResult> => {
	const startedAt = performance.now();
	const response = await fetch(
		`http://${target.host}:${target.port}/v1/execute`,
		{
			method: "POST",
			headers: {
				Authorization: `Basic ${Buffer.from(
					`${service.databaseUser}:${service.databasePassword}`,
				).toString("base64")}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ stmt: { sql: statement, want_rows: true } }),
			signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
		},
	);

	const body = (await response.json().catch(() => null)) as {
		message?: string;
		result?: LibsqlStatementResult;
	} | null;
	if (!response.ok || !body?.result) {
		throw new Error(body?.message || `LibSQL returned HTTP ${response.status}`);
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
		command: /^\s*([a-z]+)/i.exec(statement)?.[1]?.toUpperCase() || "QUERY",
		truncated: rawRows.length > maxRows,
	};
};

const runDatabaseQuery = async (
	service: DatabaseServiceConnection,
	statement: string,
	maxRows = MAX_RESULT_ROWS,
): Promise<QueryResult> => {
	const target = await getConnectionTarget(service);
	try {
		if (service.type === "postgres") {
			return await runPostgresQuery(service, target, statement, maxRows);
		}
		if (service.type === "libsql") {
			return await runLibsqlQuery(service, target, statement, maxRows);
		}
		return await runMysqlQuery(service, target, statement, maxRows);
	} finally {
		await target.close();
	}
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
				c.column_default AS "defaultValue"
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
				p.dflt_value AS "defaultValue"
			FROM sqlite_schema m
			LEFT JOIN pragma_table_info(m.name) p ON true
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
				c.COLUMN_DEFAULT AS \`defaultValue\`
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
				name: string;
				nullable: boolean;
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
				name: String(row.column),
				nullable: row.nullable === true || row.nullable === 1,
			});
		}
	}

	return {
		databaseName: service.databaseName,
		tables: [...tables.values()],
	};
};

const quoteIdentifier = (type: DatabaseIdeType, identifier: string) =>
	type === "postgres" || type === "libsql"
		? `"${identifier.replaceAll('"', '""')}"`
		: `\`${identifier.replaceAll("`", "``")}\``;

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

				const statement = `SELECT * FROM ${quoteIdentifier(service.type, input.schema)}.${quoteIdentifier(service.type, input.table)} LIMIT ${input.limit}`;
				return await runDatabaseQuery(service, statement);
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
