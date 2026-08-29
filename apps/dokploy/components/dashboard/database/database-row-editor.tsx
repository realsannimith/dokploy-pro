import { KeyRound, LockKeyhole, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { RouterOutputs } from "@/utils/api";

type SchemaTable = RouterOutputs["databaseIde"]["schema"]["tables"][number];
type CellValue = string | number | boolean | null;

interface DatabaseRowEditorProps {
	isSaving: boolean;
	onOpenChange: (open: boolean) => void;
	onSave: (values: {
		changes: Record<string, CellValue>;
		primaryKey: Record<string, CellValue>;
	}) => Promise<void>;
	open: boolean;
	row: Record<string, CellValue> | null;
	table: SchemaTable | null;
}

interface DraftValue {
	isNull: boolean;
	value: boolean | string;
}

const isLongValue = (dataType: string) =>
	/(blob|binary|bytea|json|text|xml)/i.test(dataType);

const isBooleanValue = (dataType: string) => /^(bool|boolean)$/i.test(dataType);

const booleanFromValue = (value: CellValue) =>
	value === true ||
	value === 1 ||
	value === "1" ||
	value === "t" ||
	value === "true";

const draftFromValue = (value: CellValue, dataType = ""): DraftValue => ({
	isNull: value === null,
	value:
		typeof value === "boolean" || isBooleanValue(dataType)
			? booleanFromValue(value)
			: value === null
				? ""
				: String(value),
});

const valueFromDraft = (
	draft: DraftValue,
	originalValue: CellValue,
	dataType: string,
): CellValue => {
	if (draft.isNull) return null;
	if (typeof originalValue === "boolean" || isBooleanValue(dataType)) {
		return Boolean(draft.value);
	}
	if (typeof originalValue === "number") {
		const numberValue = Number(draft.value);
		if (!Number.isFinite(numberValue)) {
			throw new Error("Enter a valid number");
		}
		return numberValue;
	}
	return String(draft.value);
};

export const DatabaseRowEditor = ({
	isSaving,
	onOpenChange,
	onSave,
	open,
	row,
	table,
}: DatabaseRowEditorProps) => {
	const [draft, setDraft] = useState<Record<string, DraftValue>>({});

	useEffect(() => {
		if (!open || !row || !table) return;
		setDraft(
			Object.fromEntries(
				table.columns.map((column) => [
					column.name,
					draftFromValue(row[column.name] ?? null, column.dataType),
				]),
			),
		);
	}, [open, row, table]);

	const editableColumns = useMemo(
		() =>
			table?.columns.filter(
				(column) => column.editable && !column.primaryKey,
			) ?? [],
		[table],
	);

	const changedColumnNames = useMemo(() => {
		if (!row) return [];
		return editableColumns
			.filter((column) => {
				const currentDraft = draft[column.name];
				if (!currentDraft) return false;
				const original = row[column.name] ?? null;
				if (currentDraft.isNull) return original !== null;
				if (original === null) return true;
				if (isBooleanValue(column.dataType)) {
					return Boolean(currentDraft.value) !== booleanFromValue(original);
				}
				return (
					currentDraft.value !== original &&
					String(currentDraft.value) !== String(original)
				);
			})
			.map((column) => column.name);
	}, [draft, editableColumns, row]);

	const save = async () => {
		if (!row || !table || changedColumnNames.length === 0) return;

		try {
			const primaryKey = Object.fromEntries(
				table.columns
					.filter((column) => column.primaryKey)
					.map((column) => [column.name, row[column.name] ?? null]),
			);
			const changes = Object.fromEntries(
				changedColumnNames.map((columnName) => {
					const column = table.columns.find(
						(candidate) => candidate.name === columnName,
					);
					const originalValue = row[columnName] ?? null;
					return [
						columnName,
						valueFromDraft(
							draft[columnName] ??
								draftFromValue(originalValue, column?.dataType),
							originalValue,
							column?.dataType ?? "",
						),
					];
				}),
			);

			await onSave({ changes, primaryKey });
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Check the values and try again",
			);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!isSaving) onOpenChange(nextOpen);
			}}
		>
			<DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
				<DialogHeader className="border-b px-6 py-5 pr-12">
					<div className="flex items-center gap-2">
						<div className="rounded-lg border bg-muted/40 p-2">
							<Pencil className="size-4 text-primary" />
						</div>
						<div className="min-w-0">
							<DialogTitle>Edit row</DialogTitle>
							<p className="mt-1 truncate font-mono text-xs text-muted-foreground">
								{table ? `${table.schema}.${table.name}` : "Database table"}
							</p>
						</div>
					</div>
					<DialogDescription>
						Only changed values are saved. Primary keys identify the exact row
						and cannot be changed here.
					</DialogDescription>
				</DialogHeader>

				<ScrollArea className="min-h-0 flex-1">
					<div className="space-y-4 px-6 py-5">
						{table?.columns.map((column, index) => {
							const fieldId = `database-row-field-${index}`;
							const currentDraft = draft[column.name] ?? {
								isNull: true,
								value: "",
							};
							const locked = !column.editable || column.primaryKey;
							const booleanValue =
								typeof (row?.[column.name] ?? null) === "boolean" ||
								isBooleanValue(column.dataType);

							return (
								<div
									key={column.name}
									className="rounded-lg border bg-background p-3"
								>
									<div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
										<Label htmlFor={fieldId} className="min-w-0 font-mono">
											<span className="truncate">{column.name}</span>
										</Label>
										<Badge variant="outline" className="font-mono font-normal">
											{column.dataType}
										</Badge>
										{column.primaryKey && (
											<Badge variant="secondary" className="gap-1">
												<KeyRound className="size-3" /> Primary key
											</Badge>
										)}
										{locked && !column.primaryKey && (
											<span className="flex items-center gap-1 text-xs text-muted-foreground">
												<LockKeyhole className="size-3" /> Generated value
											</span>
										)}
									</div>

									{booleanValue ? (
										<div className="flex h-10 items-center gap-2 rounded-lg border px-3">
											<Checkbox
												id={fieldId}
												checked={Boolean(currentDraft.value)}
												disabled={locked || currentDraft.isNull}
												onCheckedChange={(checked) =>
													setDraft((current) => ({
														...current,
														[column.name]: {
															...currentDraft,
															value: checked === true,
														},
													}))
												}
											/>
											<Label htmlFor={fieldId} className="font-normal">
												{String(Boolean(currentDraft.value))}
											</Label>
										</div>
									) : isLongValue(column.dataType) ? (
										<Textarea
											id={fieldId}
											value={String(currentDraft.value)}
											disabled={locked || currentDraft.isNull}
											className="min-h-24 font-mono text-xs"
											onChange={(event) =>
												setDraft((current) => ({
													...current,
													[column.name]: {
														...currentDraft,
														value: event.target.value,
													},
												}))
											}
										/>
									) : (
										<Input
											id={fieldId}
											type={
												typeof (row?.[column.name] ?? null) === "number"
													? "number"
													: "text"
											}
											step="any"
											value={String(currentDraft.value)}
											disabled={locked || currentDraft.isNull}
											className="font-mono text-xs"
											onChange={(event) =>
												setDraft((current) => ({
													...current,
													[column.name]: {
														...currentDraft,
														value: event.target.value,
													},
												}))
											}
										/>
									)}

									{column.nullable && !locked && (
										<div className="mt-2 flex items-center gap-2">
											<Checkbox
												id={`${fieldId}-null`}
												checked={currentDraft.isNull}
												onCheckedChange={(checked) =>
													setDraft((current) => ({
														...current,
														[column.name]: {
															...currentDraft,
															isNull: checked === true,
														},
													}))
												}
											/>
											<Label
												htmlFor={`${fieldId}-null`}
												className="font-mono text-xs font-normal text-muted-foreground"
											>
												Set to NULL
											</Label>
										</div>
									)}
								</div>
							);
						})}
					</div>
				</ScrollArea>

				<DialogFooter className="border-t bg-muted/20 px-6 py-4">
					<Button
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isSaving}
					>
						Cancel
					</Button>
					<Button
						onClick={save}
						disabled={changedColumnNames.length === 0}
						isLoading={isSaving}
					>
						{changedColumnNames.length > 0
							? `Save ${changedColumnNames.length} change${
									changedColumnNames.length === 1 ? "" : "s"
								}`
							: "Save changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
