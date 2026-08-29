import type { CompletionContext } from "@codemirror/autocomplete";
import {
	Braces,
	ChevronDown,
	ChevronRight,
	ChevronsUpDown,
	Clock3,
	Columns3,
	Database,
	KeyRound,
	LockKeyhole,
	PanelLeftClose,
	PanelLeftOpen,
	Pencil,
	Play,
	RefreshCw,
	Rows3,
	Search,
	Table2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DatabaseRowEditor } from "@/components/dashboard/database/database-row-editor";
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
type SchemaTable = RouterOutputs["databaseIde"]["schema"]["tables"][number];
type CellValue = string | number | boolean | null;

interface DatabaseIdeProps {
	canExecute: boolean;
	databaseId: string;
	databaseType: DatabaseType;
	runtime?: {
		state: "running" | "starting" | "failed" | "stopped" | "unknown";
		ready: boolean;
		message: string;
	};
	status: "idle" | "running" | "done" | "error" | undefined;
}

const quoteIdentifier = (type: DatabaseType, identifier: string) =>
	type === "postgres" || type === "libsql"
		? `"${identifier.replaceAll('"', '""')}"`
		: `\`${identifier.replaceAll("`", "``")}\``;

const tableStatement = (type: DatabaseType, schema: string, table: string) =>
	`SELECT * FROM ${quoteIdentifier(type, schema)}.${quoteIdentifier(type, table)} LIMIT 100;`;

const tableKey = (schema: string, table: string) => `${schema}\u0000${table}`;

const displayCell = (value: CellValue) => {
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
	runtime,
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
	const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
		new Set(),
	);
	const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
	const [explorerCollapsed, setExplorerCollapsed] = useState(false);
	const [editorCollapsed, setEditorCollapsed] = useState(false);
	const [editingRow, setEditingRow] = useState<Record<
		string,
		CellValue
	> | null>(null);

	const schemaQuery = api.databaseIde.schema.useQuery(
		{ databaseId, databaseType },
		{ enabled: status === "done", refetchOnWindowFocus: false, retry: false },
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
	const updateRow = api.databaseIde.updateRow.useMutation();

	const tablesBySchema = useMemo(() => {
		const normalizedSearch = search.trim().toLowerCase();
		const grouped = new Map<
			string,
			NonNullable<typeof schemaQuery.data>["tables"]
		>();
		for (const table of schemaQuery.data?.tables ?? []) {
			const matches =
				!normalizedSearch ||
				`${table.schema}.${table.name}`
					.toLowerCase()
					.includes(normalizedSearch) ||
				table.columns.some(
					(column) =>
						column.name.toLowerCase().includes(normalizedSearch) ||
						column.dataType.toLowerCase().includes(normalizedSearch),
				);
			if (!matches) continue;
			const tables = grouped.get(table.schema) ?? [];
			tables.push(table);
			grouped.set(table.schema, tables);
		}
		return [...grouped.entries()];
	}, [schemaQuery.data, search]);

	const allSchemaNames = useMemo(
		() => [
			...new Set((schemaQuery.data?.tables ?? []).map((table) => table.schema)),
		],
		[schemaQuery.data],
	);
	const filteredTableCount = useMemo(
		() =>
			tablesBySchema.reduce((total, [, tables]) => total + tables.length, 0),
		[tablesBySchema],
	);
	const selectedTableDetails = useMemo<SchemaTable | null>(
		() =>
			(schemaQuery.data?.tables ?? []).find(
				(table) =>
					table.schema === selectedTable?.schema &&
					table.name === selectedTable.table,
			) ?? null,
		[schemaQuery.data, selectedTable],
	);

	useEffect(() => {
		const firstSchema = schemaQuery.data?.tables[0]?.schema;
		if (!firstSchema) return;
		setExpandedSchemas((current) =>
			current.size > 0 ? current : new Set([firstSchema]),
		);
	}, [schemaQuery.data]);

	const activeResult =
		resultSource === "execute" ? queryResult : (previewQuery.data ?? null);
	const activeError =
		resultSource === "execute" ? executeQuery.error : previewQuery.error;
	const primaryKeyColumns =
		selectedTableDetails?.columns.filter((column) => column.primaryKey) ?? [];
	const tableIsView = selectedTableDetails?.kind.includes("VIEW") ?? false;
	const rowsCanBeEdited = Boolean(
		canExecute &&
			resultSource === "preview" &&
			selectedTableDetails &&
			!tableIsView &&
			primaryKeyColumns.length > 0,
	);

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

	const toggleSchema = (schema: string) => {
		setExpandedSchemas((current) => {
			const next = new Set(current);
			if (next.has(schema)) next.delete(schema);
			else next.add(schema);
			return next;
		});
	};

	const toggleTableColumns = (schema: string, table: string) => {
		const key = tableKey(schema, table);
		setExpandedTables((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};

	const toggleAllSchemas = () => {
		setExpandedSchemas((current) =>
			allSchemaNames.every((schema) => current.has(schema))
				? new Set()
				: new Set(allSchemaNames),
		);
	};

	const selectTable = (schema: string, table: string) => {
		executeQuery.reset();
		updateRow.reset();
		setExpandedSchemas((current) => new Set(current).add(schema));
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

	const saveRow = async (values: {
		changes: Record<string, CellValue>;
		primaryKey: Record<string, CellValue>;
	}) => {
		if (!selectedTableDetails) return;
		try {
			const result = await updateRow.mutateAsync({
				databaseId,
				databaseType,
				schema: selectedTableDetails.schema,
				table: selectedTableDetails.name,
				...values,
			});
			setEditingRow(null);
			setResultSource("preview");
			await previewQuery.refetch();
			if (result.rowsAffected === 0) {
				toast.info("No matching row was changed");
			} else {
				toast.success("Row updated");
			}
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "The row could not be updated",
			);
		}
	};

	if (status !== "done") {
		const title =
			runtime?.state === "starting"
				? "Database is still starting"
				: runtime?.state === "failed"
					? "Database failed to start"
					: runtime?.state === "stopped"
						? "Database is stopped"
						: runtime?.state === "unknown"
							? "Database status is unavailable"
							: "Database IDE will be ready after deployment";
		return (
			<div className="mt-2.5 flex min-h-[420px] items-center justify-center rounded-xl border-2 border-dashed p-6">
				<div className="flex max-w-lg flex-col items-center gap-3 text-center">
					<div className="rounded-full border bg-muted/50 p-3">
						<Database className="size-6 text-muted-foreground" />
					</div>
					<div>
						<h3 className="font-medium">{title}</h3>
						<p className="mt-1 text-sm text-muted-foreground">
							{runtime?.message ||
								"Deploy and start this database, then return here to browse its tables and run queries."}
						</p>
						{runtime && (
							<Badge variant="outline" className="capitalize">
								Live status: {runtime.state}
							</Badge>
						)}
					</div>
				</div>
			</div>
		);
	}

	return (
		<>
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
							<span>Query and row editing enabled</span>
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
							<RefreshCw className="size-4" /> Try again
						</Button>
					</div>
				) : (
					<div
						className={cn(
							"grid min-h-[700px] transition-[grid-template-columns] lg:grid-cols-[300px_minmax(0,1fr)]",
							explorerCollapsed && "lg:grid-cols-[56px_minmax(0,1fr)]",
						)}
					>
						<aside
							className={cn(
								"flex min-h-0 flex-col border-b bg-muted/10 lg:border-r lg:border-b-0",
								explorerCollapsed && "lg:hidden",
							)}
						>
							<div className="space-y-3 border-b p-3">
								<div className="flex items-center justify-between gap-2">
									<div className="flex items-center gap-2 text-sm font-medium">
										<Database className="size-4 text-muted-foreground" />{" "}
										Explorer
									</div>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon-sm"
											onClick={toggleAllSchemas}
											disabled={allSchemaNames.length === 0}
											aria-label="Expand or collapse all schemas"
											title="Expand or collapse all schemas"
										>
											<ChevronsUpDown className="size-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											onClick={() => schemaQuery.refetch()}
											disabled={schemaQuery.isFetching}
											aria-label="Refresh database schema"
											title="Refresh database schema"
										>
											<RefreshCw
												className={cn(
													"size-4",
													schemaQuery.isFetching && "animate-spin",
												)}
											/>
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											className="hidden lg:inline-flex"
											onClick={() => setExplorerCollapsed(true)}
											aria-label="Collapse database explorer"
											title="Collapse explorer"
										>
											<PanelLeftClose className="size-4" />
										</Button>
									</div>
								</div>
								<div className="relative">
									<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										value={search}
										onChange={(event) => setSearch(event.target.value)}
										placeholder="Find tables, columns, or types"
										className="h-9 pl-9"
										aria-label="Find tables, columns, or data types"
									/>
								</div>
								<p className="text-xs text-muted-foreground">
									{filteredTableCount} of {schemaQuery.data?.tables.length ?? 0}{" "}
									tables
								</p>
							</div>

							<ScrollArea className="h-[330px] flex-1 lg:h-auto">
								<div className="p-2">
									{schemaQuery.isLoading ? (
										<div className="space-y-2 p-2">
											<Skeleton className="h-5 w-24" />
											<Skeleton className="h-9 w-full" />
											<Skeleton className="h-9 w-full" />
											<Skeleton className="h-9 w-full" />
										</div>
									) : tablesBySchema.length === 0 ? (
										<div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
											<Table2 className="size-5" />
											{search
												? "No matching tables or columns"
												: "No tables yet"}
										</div>
									) : (
										tablesBySchema.map(([schema, tables]) => {
											const schemaIsOpen =
												Boolean(search.trim()) || expandedSchemas.has(schema);
											return (
												<div key={schema} className="mb-2">
													<button
														type="button"
														onClick={() => toggleSchema(schema)}
														className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
														aria-expanded={schemaIsOpen}
													>
														{schemaIsOpen ? (
															<ChevronDown className="size-3.5 shrink-0" />
														) : (
															<ChevronRight className="size-3.5 shrink-0" />
														)}
														<Database className="size-3.5 shrink-0" />
														<span className="truncate">{schema}</span>
														<span className="ml-auto tabular-nums">
															{tables.length}
														</span>
													</button>
													{schemaIsOpen && (
														<div className="mt-0.5 ml-3 border-l pl-1.5">
															{tables.map((table) => {
																const selected =
																	selectedTable?.schema === table.schema &&
																	selectedTable.table === table.name;
																const key = tableKey(table.schema, table.name);
																const matchingColumns = search.trim()
																	? table.columns.filter((column) =>
																			`${column.name} ${column.dataType}`
																				.toLowerCase()
																				.includes(search.trim().toLowerCase()),
																		)
																	: [];
																const columnsAreOpen =
																	expandedTables.has(key) ||
																	matchingColumns.length > 0;
																const visibleColumns =
																	matchingColumns.length > 0
																		? matchingColumns
																		: table.columns;
																return (
																	<div key={key} className="py-0.5">
																		<div
																			className={cn(
																				"flex min-h-9 items-center rounded-md transition-colors hover:bg-muted",
																				selected &&
																					"bg-primary/10 text-primary",
																			)}
																		>
																			<button
																				type="button"
																				onClick={() =>
																					toggleTableColumns(
																						table.schema,
																						table.name,
																					)
																				}
																				disabled={table.columns.length === 0}
																				className="ml-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
																				aria-label={`${columnsAreOpen ? "Collapse" : "Expand"} columns for ${table.name}`}
																				aria-expanded={columnsAreOpen}
																			>
																				{columnsAreOpen ? (
																					<ChevronDown className="size-3.5" />
																				) : (
																					<ChevronRight className="size-3.5" />
																				)}
																			</button>
																			<button
																				type="button"
																				onClick={() =>
																					selectTable(table.schema, table.name)
																				}
																				className="flex min-w-0 flex-1 items-center gap-2 self-stretch pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
																			>
																				<Table2 className="size-3.5 shrink-0" />
																				<span className="truncate font-mono text-xs">
																					{table.name}
																				</span>
																				<span className="ml-auto text-[10px] text-muted-foreground">
																					{table.kind.includes("VIEW")
																						? "VIEW"
																						: "TABLE"}
																				</span>
																			</button>
																		</div>
																		{columnsAreOpen && (
																			<div className="ml-8 border-l py-1 pl-1.5">
																				{visibleColumns.map((column) => (
																					<div
																						key={column.name}
																						className="flex min-h-7 items-center gap-1.5 rounded px-1.5 text-xs hover:bg-muted/60"
																					>
																						{column.primaryKey ? (
																							<KeyRound className="size-3 shrink-0 text-primary" />
																						) : (
																							<Columns3 className="size-3 shrink-0 text-muted-foreground" />
																						)}
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
													)}
												</div>
											);
										})
									)}
								</div>
							</ScrollArea>
						</aside>

						<aside
							className={cn(
								"hidden min-h-0 flex-col items-center border-r bg-muted/10 py-3",
								explorerCollapsed && "lg:flex",
							)}
						>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => setExplorerCollapsed(false)}
								aria-label="Open database explorer"
								title="Open explorer"
							>
								<PanelLeftOpen className="size-4" />
							</Button>
							<div className="mt-3 flex flex-1 items-start [writing-mode:vertical-rl]">
								<span className="text-xs font-medium tracking-wide text-muted-foreground">
									Explorer · {schemaQuery.data?.tables.length ?? 0} tables
								</span>
							</div>
						</aside>

						<section className="min-w-0">
							<div className="flex min-h-12 items-center justify-between gap-3 border-b px-3">
								<button
									type="button"
									onClick={() => setEditorCollapsed((current) => !current)}
									className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									aria-expanded={!editorCollapsed}
								>
									{editorCollapsed ? (
										<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
									) : (
										<ChevronDown className="size-4 shrink-0 text-muted-foreground" />
									)}
									<Braces className="size-4 shrink-0 text-muted-foreground" />
									<span className="truncate font-medium">SQL query</span>
									{!canExecute && (
										<Badge variant="secondary">Preview only</Badge>
									)}
								</button>
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
									<Play className="size-3.5" /> Run
								</Button>
							</div>
							{!editorCollapsed && (
								<div
									className="border-b"
									onKeyDown={(event) => {
										if (
											(event.metaKey || event.ctrlKey) &&
											event.key === "Enter"
										) {
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
										wrapperClassName="h-[220px]"
										className="h-[220px]"
										aria-label="SQL query editor"
									/>
								</div>
							)}

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
											<Clock3 className="size-3.5" /> {activeResult.durationMs}{" "}
											ms
										</span>
										<span>{activeResult.command}</span>
										{activeResult.truncated && (
											<Badge variant="secondary">First 500 rows</Badge>
										)}
									</>
								)}
								{resultSource === "preview" && selectedTableDetails && (
									<Badge
										variant={rowsCanBeEdited ? "outline" : "secondary"}
										className="ml-auto gap-1"
										title={
											!canExecute
												? "You have read-only access"
												: tableIsView
													? "Views cannot be edited"
													: primaryKeyColumns.length === 0
														? "Add a primary key to edit rows safely"
														: "Open a row to edit its values"
										}
									>
										{rowsCanBeEdited ? (
											<Pencil className="size-3" />
										) : (
											<LockKeyhole className="size-3" />
										)}
										{rowsCanBeEdited
											? "Rows editable"
											: tableIsView
												? "Read-only view"
												: primaryKeyColumns.length === 0
													? "No primary key"
													: "Read-only"}
									</Badge>
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
								<ScrollArea
									className={cn(
										"h-[370px] w-full",
										editorCollapsed && "h-[590px]",
									)}
								>
									<Table>
										<TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
											<TableRow>
												{rowsCanBeEdited && (
													<TableHead className="sticky left-0 z-20 w-14 min-w-14 bg-background text-center">
														Edit
													</TableHead>
												)}
												{activeResult.headers.map((header) => {
													const schemaColumn =
														selectedTableDetails?.columns.find(
															(column) => column.name === header.name,
														);
													return (
														<TableHead
															key={header.name}
															title={header.type}
															className="whitespace-nowrap"
														>
															<span className="inline-flex items-center gap-1.5">
																{schemaColumn?.primaryKey && (
																	<KeyRound className="size-3 text-primary" />
																)}
																{header.displayName}
															</span>
														</TableHead>
													);
												})}
											</TableRow>
										</TableHeader>
										<TableBody>
											{activeResult.rows.map((row, rowIndex) => {
												const hasCompletePrimaryKey = primaryKeyColumns.every(
													(column) => row[column.name] != null,
												);
												return (
													<TableRow key={`row-${rowIndex}`}>
														{rowsCanBeEdited && (
															<TableCell className="sticky left-0 z-[5] bg-background text-center">
																<Button
																	variant="ghost"
																	size="icon-xs"
																	onClick={() => setEditingRow(row)}
																	disabled={!hasCompletePrimaryKey}
																	aria-label={
																		hasCompletePrimaryKey
																			? `Edit row ${rowIndex + 1}`
																			: `Row ${rowIndex + 1} has an empty primary key`
																	}
																	title={
																		hasCompletePrimaryKey
																			? `Edit row ${rowIndex + 1}`
																			: "Rows with an empty primary key cannot be edited safely"
																	}
																>
																	<Pencil className="size-3.5" />
																</Button>
															</TableCell>
														)}
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
												);
											})}
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

			<DatabaseRowEditor
				open={editingRow !== null}
				onOpenChange={(open) => {
					if (!open) setEditingRow(null);
				}}
				table={selectedTableDetails}
				row={editingRow}
				isSaving={updateRow.isPending}
				onSave={saveRow}
			/>
		</>
	);
};
