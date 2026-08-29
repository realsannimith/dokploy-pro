import { emitKeypressEvents, type Key } from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import {
	dimText,
	promptText,
	renderStatusBar,
	type StatusBarData,
	warningText,
} from "./terminal-ui";

const ESC = "\u001B[";

const characters = (value: string) => Array.from(value);

export interface ComposerQuestion {
	status?: StatusBarData;
	label?: string;
	placeholder?: string;
	initialValue?: string;
	tone?: "primary" | "warning";
	allowMultiline?: boolean;
	recordHistory?: boolean;
}

export interface ComposerView {
	text: string;
	rows: number;
	cursorRow: number;
	cursorColumn: number;
}

const layoutValue = (value: string, cursor: number, columns: number) => {
	const cells = characters(value);
	const lines = [""];
	let row = 0;
	let column = 0;
	let cursorRow = 0;
	let cursorColumn = 0;

	for (let index = 0; index <= cells.length; index += 1) {
		if (index === cursor) {
			cursorRow = row;
			cursorColumn = column;
		}
		if (index === cells.length) break;
		const cell = cells[index] ?? "";
		if (cell === "\n") {
			lines.push("");
			row += 1;
			column = 0;
			continue;
		}
		if (column >= columns) {
			lines.push("");
			row += 1;
			column = 0;
			if (index === cursor) {
				cursorRow = row;
				cursorColumn = column;
			}
		}
		lines[row] = `${lines[row] ?? ""}${cell}`;
		column += 1;
	}

	return { lines, cursorRow, cursorColumn };
};

/**
 * Pure renderer for the interactive composer. The returned cursor coordinates
 * let the live input redraw without leaving duplicate prompts in the terminal.
 */
export const renderComposerView = (
	question: ComposerQuestion,
	value = "",
	cursor = characters(value).length,
	columns = 80,
	colors = true,
): ComposerView => {
	const width = Math.max(18, columns - 1);
	const label = question.label ? `${question.label}: ` : "";
	const prefixPlain = `❯ ${label}`;
	const prefixWidth = Math.min(width - 1, characters(prefixPlain).length);
	const inputWidth = Math.max(1, width - prefixWidth);
	const input = layoutValue(value, cursor, inputWidth);
	const prefix = `${promptText(colors)}${
		question.tone === "warning" ? warningText(label, colors) : label
	}`;
	const blankPrefix = " ".repeat(prefixWidth);
	const inputLines = input.lines.map((line, index) => {
		const renderedPrefix = index === 0 ? prefix : blankPrefix;
		if (index === 0 && !value && question.placeholder) {
			return `${renderedPrefix}${dimText(question.placeholder, colors)}`;
		}
		return `${renderedPrefix}${line}`;
	});
	const chrome = question.status
		? [renderStatusBar(question.status, columns, colors), ""]
		: [];
	const lines = [...chrome, ...inputLines];

	return {
		text: lines.join("\n"),
		rows: lines.length,
		cursorRow: chrome.length + input.cursorRow,
		cursorColumn: prefixWidth + input.cursorColumn,
	};
};

interface ActiveQuestion {
	question: ComposerQuestion;
	value: string;
	cursor: number;
	resolve: (value: string | null) => void;
}

/**
 * Small raw-mode editor tailored to the Dokploy harness. It provides the
 * persistent, redrawable Hermes-style composer without pulling a browser UI or
 * a second terminal framework into the server image.
 */
export class HarnessComposer {
	private active?: ActiveQuestion;
	private closed = false;
	private renderedRows = 0;
	private renderedCursorRow = 0;
	private readonly history: string[] = [];
	private historyIndex = 0;
	private historyDraft = "";
	private readonly wasRaw: boolean;

	constructor(
		private readonly input: ReadStream,
		private readonly output: WriteStream,
		private readonly colors = true,
		private readonly onInterrupt?: () => void,
		private readonly onClose?: () => void,
	) {
		this.wasRaw = Boolean(input.isRaw);
		emitKeypressEvents(input);
		input.setRawMode(true);
		input.resume();
		input.on("keypress", this.handleKeypress);
		output.on("resize", this.handleResize);
	}

	ask(question: ComposerQuestion): Promise<string | null> {
		if (this.closed) return Promise.resolve(null);
		if (this.active) {
			throw new Error("The terminal composer is already waiting for input.");
		}
		return new Promise((resolve) => {
			const value = question.initialValue ?? "";
			this.active = {
				question,
				value,
				cursor: characters(value).length,
				resolve,
			};
			this.historyIndex = this.history.length;
			this.historyDraft = value;
			this.draw();
		});
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.clearView();
		const active = this.active;
		this.active = undefined;
		active?.resolve(null);
		this.input.off("keypress", this.handleKeypress);
		this.output.off("resize", this.handleResize);
		this.input.setRawMode(this.wasRaw);
		this.input.pause();
		this.onClose?.();
	}

	private readonly handleResize = () => {
		if (this.active) this.draw();
	};

	private readonly handleKeypress = (input: string, key: Key) => {
		if (key.ctrl && key.name === "c") {
			this.cancelActive();
			this.onInterrupt?.();
			return;
		}
		if (key.ctrl && key.name === "d" && !this.active?.value) {
			this.cancelActive();
			this.close();
			return;
		}
		const active = this.active;
		if (!active) return;

		if (key.name === "return" || key.name === "enter") {
			if (
				active.question.allowMultiline !== false &&
				(key.meta || key.shift || key.ctrl)
			) {
				this.insert("\n");
			} else {
				this.submit();
			}
			return;
		}
		if (key.name === "backspace") {
			this.backspace();
			return;
		}
		if (key.name === "delete" || (key.ctrl && key.name === "d")) {
			this.deleteForward();
			return;
		}
		if (key.name === "left") {
			active.cursor = Math.max(0, active.cursor - 1);
			this.draw();
			return;
		}
		if (key.name === "right") {
			active.cursor = Math.min(
				characters(active.value).length,
				active.cursor + 1,
			);
			this.draw();
			return;
		}
		if (key.name === "home" || (key.ctrl && key.name === "a")) {
			active.cursor = 0;
			this.draw();
			return;
		}
		if (key.name === "end" || (key.ctrl && key.name === "e")) {
			active.cursor = characters(active.value).length;
			this.draw();
			return;
		}
		if (key.name === "up" && !active.value.includes("\n")) {
			this.previousHistory();
			return;
		}
		if (key.name === "down" && !active.value.includes("\n")) {
			this.nextHistory();
			return;
		}
		if (key.ctrl && key.name === "u") {
			const value = characters(active.value);
			active.value = value.slice(active.cursor).join("");
			active.cursor = 0;
			this.draw();
			return;
		}
		if (key.ctrl && key.name === "k") {
			active.value = characters(active.value).slice(0, active.cursor).join("");
			this.draw();
			return;
		}
		if (key.ctrl && key.name === "w") {
			this.deleteWord();
			return;
		}
		if (key.name === "escape") {
			active.value = "";
			active.cursor = 0;
			this.draw();
			return;
		}
		if (key.name === "tab") {
			this.insert("  ");
			return;
		}
		if (!key.ctrl && !key.meta && input && !input.startsWith("\u001B")) {
			const printable = characters(input)
				.filter(
					(cell) =>
						(cell === "\n" && active.question.allowMultiline !== false) ||
						cell === "\t" ||
						cell >= " ",
				)
				.join("");
			if (printable) this.insert(printable);
		}
	};

	private insert(text: string) {
		const active = this.active;
		if (!active) return;
		const value = characters(active.value);
		const inserted = characters(text);
		value.splice(active.cursor, 0, ...inserted);
		active.value = value.join("");
		active.cursor += inserted.length;
		this.draw();
	}

	private backspace() {
		const active = this.active;
		if (!active || active.cursor === 0) return;
		const value = characters(active.value);
		value.splice(active.cursor - 1, 1);
		active.value = value.join("");
		active.cursor -= 1;
		this.draw();
	}

	private deleteForward() {
		const active = this.active;
		if (!active) return;
		const value = characters(active.value);
		if (active.cursor >= value.length) return;
		value.splice(active.cursor, 1);
		active.value = value.join("");
		this.draw();
	}

	private deleteWord() {
		const active = this.active;
		if (!active || active.cursor === 0) return;
		const value = characters(active.value);
		let start = active.cursor;
		while (start > 0 && /\s/.test(value[start - 1] ?? "")) start -= 1;
		while (start > 0 && !/\s/.test(value[start - 1] ?? "")) start -= 1;
		value.splice(start, active.cursor - start);
		active.value = value.join("");
		active.cursor = start;
		this.draw();
	}

	private previousHistory() {
		const active = this.active;
		if (!active || this.history.length === 0) return;
		if (this.historyIndex === this.history.length) {
			this.historyDraft = active.value;
		}
		this.historyIndex = Math.max(0, this.historyIndex - 1);
		active.value = this.history[this.historyIndex] ?? "";
		active.cursor = characters(active.value).length;
		this.draw();
	}

	private nextHistory() {
		const active = this.active;
		if (!active || this.historyIndex >= this.history.length) return;
		this.historyIndex += 1;
		active.value =
			this.historyIndex === this.history.length
				? this.historyDraft
				: (this.history[this.historyIndex] ?? "");
		active.cursor = characters(active.value).length;
		this.draw();
	}

	private submit() {
		const active = this.active;
		if (!active) return;
		this.clearView();
		this.active = undefined;
		const value = active.value;
		if (value.trim() && active.question.recordHistory !== false) {
			const duplicate = this.history.indexOf(value);
			if (duplicate >= 0) this.history.splice(duplicate, 1);
			this.history.push(value);
			if (this.history.length > 200) this.history.shift();
		}
		active.resolve(value);
	}

	private cancelActive() {
		const active = this.active;
		if (!active) return;
		this.clearView();
		this.active = undefined;
		active.resolve(null);
	}

	private draw() {
		const active = this.active;
		if (!active) return;
		this.clearView();
		const view = renderComposerView(
			active.question,
			active.value,
			active.cursor,
			this.output.columns ?? 80,
			this.colors,
		);
		this.output.write(view.text);
		const rowsUp = view.rows - view.cursorRow - 1;
		this.output.write("\r");
		if (rowsUp > 0) this.output.write(`${ESC}${rowsUp}A`);
		this.output.write(`${ESC}${view.cursorColumn + 1}G`);
		this.renderedRows = view.rows;
		this.renderedCursorRow = view.cursorRow;
	}

	private clearView() {
		if (this.renderedRows === 0) return;
		this.output.write("\r");
		if (this.renderedCursorRow > 0) {
			this.output.write(`${ESC}${this.renderedCursorRow}A`);
		}
		this.output.write(`${ESC}0J`);
		this.renderedRows = 0;
		this.renderedCursorRow = 0;
	}
}
