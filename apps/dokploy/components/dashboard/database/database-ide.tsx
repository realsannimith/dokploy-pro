import type { CompletionContext } from "@codemirror/autocomplete";
import {
	Braces,
	Clock3,
	Columns3,
	Database,
	LockKeyhole,
	Play,
	RefreshCw,
	Rows3,
	Search,
	Table2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { CodeEditor } from "@/components/shared/code-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/utils/api";

type DatabaseType = "postgres" | "mysql" | "mariadb" | "libsql";
type IdeResult = RouterOutputs["databaseIde"]["execute"];

interface DatabaseIdeProps {
	canExecute: boolean;
	databaseId: string;
	databaseType: DatabaseType;
	status: "idle" | "running" | "done" | "error" | undefined;
}

const quoteIdentifier = (type: DatabaseType, identifier: string) =>
	type === "postgres" || type === "libsql"
		? `"${identifier.replaceAll('"', '""')}"`
		: `\`${identifier.replaceAll("`", "``")}\``;

const tableStatement = (type: DatabaseType, schema: string, table: string) =>
	`SELECT * FROM ${quoteIdentifier(type, schema)}.${quoteIdentifier(type, table)} LIMIT 100;`;

const displayCell = (value: string | number | boolean | null) => {
	if (value === null) {
		return (
			<span className="font-mono text-xs italic text-muted-foreground">
				NULL
			</span>
		);
	}
	if (typeof value === "boolean") {
		return (
			<Badge variant="outline" className="font-mono font-normal">
				{String(value)}
			</Badge>
		);
	}
	return String(value);
};

export const DatabaseIde = ({
	canExecute,
	databaseId,
	databaseType,
	status,
}: DatabaseIdeProps) => {
	const [search, setSearch] = useState("");
	const [selectedTable, setSelectedTable] = useState<{
		schema: string;
		table: string;
	} | null>(null);
	const [statement, setStatement] = useState("SELECT 1;");
	const [queryResult, setQueryResult] = useState<IdeResult | null>(null);
	const [resultSource, setResultSource] = useState<"preview" | "execute">(
		"preview",
	);

	const schemaQuery = api.databaseIde.schema.useQuery(
		{ databaseId, databaseType },
		{
			enabled: status === "done",
			refetchOnWindowFocus: false,
			retry: false,
		},
	);
	const previewQuery = api.databaseIde.previewTable.useQuery(
		{
			databaseId,
			databaseType,
			schema: selectedTable?.schema ?? "",
			table: selectedTable?.table ?? "",
			limit: 100,
		},
		{
			enabled: status === "done" && selectedTable !== null,
			refetchOnWindowFocus: false,
			retry: false,
		},
	);
	const executeQuery = api.databaseIde.execute.useMutation();

	const tablesBySchema = useMemo(() => {
		const normalizedSearch = search.trim().toLowerCase();
		const grouped = new Map<
			string,
			NonNullable<typeof schemaQuery.data>["tables"]
		>();

		for (const table of schemaQuery.data?.tables ?? []) {
			if (
				normalizedSearch &&
				!`${table.schema}.${table.name}`
					.toLowerCase()
					.includes(normalizedSearch) &&
				!table.columns.some((column) =>
					column.name.toLowerCase().includes(normalizedSearch),
				)
			) {
				continue;
			}

			const tables = grouped.get(table.schema) ?? [];
			tables.push(table);
			grouped.set(table.schema, tables);
		}

		return [...grouped.entries()];
	}, [schemaQuery.data, search]);

	const activeResult =
		resultSource === "execute" ? queryResult : (previewQuery.data ?? null);
	const activeError =
		resultSource === "execute" ? executeQuery.error : previewQuery.error;

	const completionSource = (context: CompletionContext) => {
		const word = context.matchBefore(/[\w.]*/);
		if (!word || (!word.text && !context.explicit)) return null;

		return {
			from: word.from,
			options: (schemaQuery.data?.tables ?? []).flatMap((table) => [
				{
					label: `${table.schema}.${table.name}`,
					type: "class",
					detail: table.kind,
				},
				...table.columns.map((column) => ({
					label: column.name,
					type: "property",
					detail: `${table.name} · ${column.dataType}`,
				})),
			]),
			validFor: /^[\w.]*$/,
		};
	};

	const selectTable = (schema: string, table: string) => {
		executeQuery.reset();
		setSelectedTable({ schema, table });
		setStatement(tableStatement(databaseType, schema, table));
		setQueryResult(null);
		setResultSource("preview");
	};

	const runStatement = async () => {
		if (!canExecute || !statement.trim()) return;
		setResultSource("execute");
		try {
			const result = await executeQuery.mutateAsync({
				databaseId,
				databaseType,
				statement,
			});
			setQueryResult(result);
			toast.success("Query completed");
		} catch {
			setQueryResult(null);
		}
	};

	if (status !== "done") {
		return (
			<div className="mt-2.5 flex min-h-[420px] items-center justify-center rounded-xl border-2 border-dashed p-6">
				<div className="flex max-w-lg flex-col items-center gap-3 text-center">
					<div className="rounded-full border bg-muted/50 p-3">
						<Database className="size-6 text-muted-foreground" />
					</div>
					<div>
						<h3 className="font-medium">
							Database IDE will be ready after deployment
						</h3>
						<p className="mt-1 text-sm text-muted-foreground">
							Deploy and start this database, then return here to browse its
							tables and run queries.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="mt-2.5 overflow-hidden rounded-xl border bg-background">
			<div className="flex flex-col gap-3 border-b bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-3">
					<div className="rounded-lg border bg-background p-2">
						<Braces className="size-4 text-primary" />
					</div>
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<h3 className="font-medium">Database IDE</h3>
							<Badge variant="outline" className="capitalize">
								{databaseType}
							</Badge>
						</div>
						<p className="truncate text-xs text-muted-foreground">
							{schemaQuery.data?.databaseName ?? "Loading database…"}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					{canExecute ? (
						<span>Queries use this database&apos;s configured user</span>
					) : (
						<span className="flex items-center gap-1.5">
							<LockKeyhole className="size-3.5" /> Read-only access
						</span>
					)}
				</div>
			</div>

			{schemaQuery.error ? (
				<div className="space-y-3 p-4">
					<AlertBlock type="error">{schemaQuery.error.message}</AlertBlock>
					<Button
						variant="outline"
						onClick={() => schemaQuery.refetch()}
						isLoading={schemaQuery.isFetching}
					>
						<RefreshCw className="size-4" />
						Try again
					</Button>
				</div>
			) : (
				<div className="grid min-h-[650px] lg:grid-cols-[270px_minmax(0,1fr)]">
					<aside className="flex min-h-0 flex-col border-b bg-muted/10 lg:border-r lg:border-b-0">
						<div className="space-y-3 border-b p-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2 text-sm font-medium">
									<Database className="size-4 text-muted-foreground" />
									Explorer
								</div>
								<Button
									variant="ghost"
									size="icon"
									className="size-9"
									onClick={() => schemaQuery.refetch()}
									disabled={schemaQuery.isFetching}
									aria-label="Refresh database schema"
								>
									<RefreshCw
										className={cn(
											"size-4",
											schemaQuery.isFetching && "animate-spin",
										)}
									/>
								</Button>
							</div>
							<div className="relative">
								<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder="Find tables or columns"
									className="h-10 pl-9"
									aria-label="Find tables or columns"
								/>
							</div>
						</div>

						<ScrollArea className="h-[300px] flex-1 lg:h-auto">
							<div className="p-2">
								{schemaQuery.isLoading ? (
									<div className="space-y-2 p-2">
										<Skeleton className="h-5 w-24" />
										<Skeleton className="h-10 w-full" />
										<Skeleton className="h-10 w-full" />
										<Skeleton className="h-10 w-full" />
									</div>
								) : tablesBySchema.length === 0 ? (
									<div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
										<Table2 className="size-5" />
										{search ? "No matching tables" : "No tables yet"}
									</div>
								) : (
									tablesBySchema.map(([schema, tables]) => (
										<div key={schema} className="mb-3">
											<div className="flex h-8 items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
												<Database className="size-3.5" />
												<span className="truncate">{schema}</span>
												<span className="ml-auto tabular-nums">
													{tables.length}
												</span>
											</div>
											{tables.map((table) => {
												const selected =
													selectedTable?.schema === table.schema &&
													selectedTable.table === table.name;
												return (
													<div key={`${table.schema}.${table.name}`}>
														<button
															type="button"
															onClick={() =>
																selectTable(table.schema, table.name)
															}
															className={cn(
																"flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
																selected && "bg-primary/10 text-primary",
															)}
														>
															<Table2 className="size-3.5 shrink-0" />
															<span className="truncate font-mono text-xs">
																{table.name}
															</span>
															<span className="ml-auto text-[10px] text-muted-foreground">
																{table.kind.includes("VIEW") ? "VIEW" : "TABLE"}
															</span>
														</button>
														{selected && (
															<div className="ml-5 border-l py-1 pl-2">
																{table.columns.map((column) => (
																	<div
																		key={column.name}
																		className="flex min-h-8 items-center gap-2 px-2 text-xs"
																	>
																		<Columns3 className="size-3 text-muted-foreground" />
																		<span className="min-w-0 flex-1 truncate font-mono">
																			{column.name}
																		</span>
																		<span className="max-w-20 truncate text-[10px] text-muted-foreground">
																			{column.dataType}
																		</span>
																	</div>
																))}
															</div>
														)}
													</div>
												);
											})}
										</div>
									))
								)}
							</div>
						</ScrollArea>
					</aside>

					<section className="min-w-0">
						<div className="flex min-h-12 items-center justify-between gap-3 border-b px-3">
							<div className="flex min-w-0 items-center gap-2 text-sm">
								<Braces className="size-4 shrink-0 text-muted-foreground" />
								<span className="truncate font-medium">SQL query</span>
								{!canExecute && <Badge variant="secondary">Preview only</Badge>}
							</div>
							<Button
								size="sm"
								onClick={runStatement}
								disabled={!canExecute || !statement.trim()}
								isLoading={executeQuery.isPending}
								className="min-h-9 gap-2"
								title={
									canExecute
										? "Run query (Ctrl or Command + Enter)"
										: "Service create permission is required to run custom queries"
								}
							>
								<Play className="size-3.5" />
								Run
							</Button>
						</div>
						<div
							className="border-b"
							onKeyDown={(event) => {
								if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
									event.preventDefault();
									runStatement();
								}
							}}
						>
							<CodeEditor
								language={databaseType}
								value={statement}
								onChange={setStatement}
								disabled={!canExecute}
								completionSource={completionSource}
								wrapperClassName="h-[240px]"
								className="h-[240px]"
								aria-label="SQL query editor"
							/>
						</div>

						<div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/10 px-4 text-xs text-muted-foreground">
							<span className="flex items-center gap-1.5">
								<Rows3 className="size-3.5" />
								{activeResult
									? `${activeResult.rows.length} rows`
									: "No result"}
							</span>
							{activeResult && (
								<>
									<span className="flex items-center gap-1.5">
										<Clock3 className="size-3.5" />
										{activeResult.durationMs} ms
									</span>
									<span>{activeResult.command}</span>
									{activeResult.truncated && (
										<Badge variant="secondary">First 500 rows</Badge>
									)}
								</>
							)}
						</div>

						{activeError ? (
							<div className="p-4">
								<AlertBlock type="error">{activeError.message}</AlertBlock>
							</div>
						) : previewQuery.isFetching || executeQuery.isPending ? (
							<div className="space-y-2 p-4">
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-4/5" />
							</div>
						) : activeResult?.headers.length ? (
							<ScrollArea className="h-[300px] w-full">
								<Table>
									<TableHeader className="sticky top-0 z-10 bg-background">
										<TableRow>
											{activeResult.headers.map((header) => (
												<TableHead key={header.name} title={header.type}>
													{header.displayName}
												</TableHead>
											))}
										</TableRow>
									</TableHeader>
									<TableBody>
										{activeResult.rows.map((row, rowIndex) => (
											<TableRow key={`row-${rowIndex}`}>
												{activeResult.headers.map((header) => (
													<TableCell
														key={header.name}
														className="max-w-80 truncate font-mono text-xs"
														title={
															row[header.name] === null
																? "NULL"
																: String(row[header.name] ?? "")
														}
													>
														{displayCell(row[header.name] ?? null)}
													</TableCell>
												))}
											</TableRow>
										))}
									</TableBody>
								</Table>
								<ScrollBar orientation="horizontal" />
							</ScrollArea>
						) : activeResult ? (
							<div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
								<div className="rounded-full border bg-muted/40 p-2.5">
									<Rows3 className="size-5 text-muted-foreground" />
								</div>
								<p className="text-sm font-medium">Query completed</p>
								<p className="text-xs text-muted-foreground">
									{activeResult.rowsAffected} rows affected
								</p>
							</div>
						) : (
							<div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
								<Table2 className="size-5" />
								<p className="text-sm">Select a table to preview its rows</p>
							</div>
						)}
					</section>
				</div>
			)}
		</div>
	);
};
