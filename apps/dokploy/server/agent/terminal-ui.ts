import type { Writable } from "node:stream";

const ESC = "\u001B[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ANSI_ESCAPE_PATTERN = new RegExp(
	`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
	"g",
);

const rgb = (red: number, green: number, blue: number) =>
	`${ESC}38;2;${red};${green};${blue}m`;

export const HARNESS_THEME = {
	primary: rgb(167, 139, 250),
	accent: rgb(34, 211, 238),
	text: rgb(226, 232, 240),
	muted: rgb(148, 163, 184),
	border: rgb(100, 116, 139),
	ok: rgb(74, 222, 128),
	warn: rgb(251, 191, 36),
	error: rgb(248, 113, 113),
};

export const stripAnsi = (value: string) =>
	value.replace(ANSI_ESCAPE_PATTERN, "");

const paint = (value: string, color: string, enabled = true) =>
	enabled ? `${color}${value}${RESET}` : value;

const emphasize = (value: string, color: string, enabled = true) =>
	enabled ? `${BOLD}${color}${value}${RESET}` : value;

export interface HarnessArgs {
	agentId?: string;
	sessionKey?: string;
	showHistory: boolean;
	help: boolean;
}

export const parseHarnessArgs = (args: string[]): HarnessArgs => {
	const parsed: HarnessArgs = {
		showHistory: true,
		help: false,
	};
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--help" || argument === "-h") {
			parsed.help = true;
			continue;
		}
		if (argument === "--no-history") {
			parsed.showHistory = false;
			continue;
		}
		if (argument === "--agent" || argument === "--session") {
			const value = args[index + 1]?.trim();
			if (!value || value.startsWith("-")) {
				throw new Error(`${argument} requires a value`);
			}
			if (argument === "--agent") parsed.agentId = value;
			else parsed.sessionKey = value;
			index += 1;
			continue;
		}
		throw new Error(`Unknown option: ${argument}`);
	}
	return parsed;
};

export const HARNESS_USAGE = `Usage: dokploypro-harness [options]

Options:
  --agent <id>       Open a specific configured agent
  --session <name>   Use a separate local terminal session
  --no-history       Do not print recent messages at startup
  -h, --help         Show this help`;

const WIDE_LOGO = [
	"██████╗  ██████╗ ██╗  ██╗██████╗ ██╗      ██████╗ ██╗   ██╗",
	"██╔══██╗██╔═══██╗██║ ██╔╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝",
	"██║  ██║██║   ██║█████╔╝ ██████╔╝██║     ██║   ██║ ╚████╔╝ ",
	"██║  ██║██║   ██║██╔═██╗ ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  ",
	"██████╔╝╚██████╔╝██║  ██╗██║     ███████╗╚██████╔╝   ██║   ",
	"╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝   ",
];

const clip = (value: string, width: number) => {
	if (value.length <= width) return value;
	return width <= 1 ? value.slice(0, width) : `${value.slice(0, width - 1)}…`;
};

const center = (value: string, width: number) => {
	const fitted = clip(value, width);
	const remaining = Math.max(0, width - fitted.length);
	const left = Math.floor(remaining / 2);
	return `${" ".repeat(left)}${fitted}${" ".repeat(remaining - left)}`;
};

export const renderBanner = (columns = 80, version = "dev", colors = true) => {
	const width = Math.max(24, columns - 2);
	if (columns >= 70) {
		const lines = WIDE_LOGO.map((line, index) =>
			paint(
				line,
				index < 2
					? HARNESS_THEME.primary
					: index < 4
						? HARNESS_THEME.accent
						: HARNESS_THEME.border,
				colors,
			),
		);
		lines.push(
			paint(
				`  ◈ PRO HARNESS · local agentic operations · ${version}`,
				HARNESS_THEME.muted,
				colors,
			),
		);
		return lines.join("\n");
	}
	if (columns >= 38) {
		const label = ` DOKPLOY PRO HARNESS · ${version} `;
		const remaining = Math.max(0, width - label.length);
		const left = Math.floor(remaining / 2);
		return [
			paint(
				`${"─".repeat(left)}${clip(label, width)}${"─".repeat(remaining - left)}`,
				HARNESS_THEME.primary,
				colors,
			),
			paint(
				center("◈ local agentic operations", width),
				HARNESS_THEME.muted,
				colors,
			),
		].join("\n");
	}
	return emphasize("◈ DOKPLOY PRO", HARNESS_THEME.primary, colors);
};

export interface SessionPanelData {
	agent: string;
	organization: string;
	model: string;
	session: string;
	tools: number;
	skills: number;
	memories: number;
}

export const renderSessionPanel = (
	data: SessionPanelData,
	columns = 80,
	colors = true,
) => {
	const width = Math.max(20, Math.min(76, columns - 2));
	const inner = width - 2;
	const row = (glyph: string, value: string) => {
		const plain = `  ${glyph}  ${value}`;
		const fitted = clip(plain, inner).padEnd(inner);
		return `${paint("│", HARNESS_THEME.border, colors)}${paint(
			fitted,
			HARNESS_THEME.text,
			colors,
		)}${paint("│", HARNESS_THEME.border, colors)}`;
	};
	const title = clip(" DOKPLOY PRO · AGENT SESSION ", Math.max(1, width - 3));
	const top = `╭─${title}${"─".repeat(Math.max(0, width - title.length - 3))}╮`;
	return [
		paint(top, HARNESS_THEME.border, colors),
		row("◆", `${data.agent} · ${data.organization}`),
		row("⚕", data.model),
		row("◫", data.session),
		row(
			"┊",
			`${data.tools} tools · ${data.skills} skills · ${data.memories} memories`,
		),
		paint(`╰${"─".repeat(inner)}╯`, HARNESS_THEME.border, colors),
	].join("\n");
};

export interface StatusBarData {
	model: string;
	session: string;
	messages: number;
	tools: number;
	skills: number;
	elapsedMs: number;
}

const formatElapsed = (durationMs: number) => {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export const renderStatusBar = (
	data: StatusBarData,
	columns = 80,
	colors = true,
) => {
	const width = Math.max(20, columns - 2);
	const model = clip(data.model, columns >= 76 ? 26 : 18);
	const session = clip(data.session, Math.max(10, Math.floor(columns / 3)));
	const elapsed = formatElapsed(data.elapsedMs);
	const sections =
		columns >= 76
			? [
					`⚕ ${model}`,
					`${data.messages} msgs`,
					`${data.tools} tools`,
					`${data.skills} skills`,
					elapsed,
					session,
				]
			: columns >= 52
				? [`⚕ ${model}`, `${data.messages} msgs`, elapsed, session]
				: [`⚕ ${model}`, elapsed];
	return paint(clip(sections.join(" │ "), width), HARNESS_THEME.muted, colors);
};

const inlineMarkdown = (line: string, colors: boolean) => {
	if (!colors) {
		return line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
	}
	return line
		.replace(
			/`([^`]+)`/g,
			`${HARNESS_THEME.warn}$1${RESET}${HARNESS_THEME.text}`,
		)
		.replace(
			/\*\*(.+?)\*\*/g,
			`${BOLD}${HARNESS_THEME.text}$1${RESET}${HARNESS_THEME.text}`,
		);
};

export const renderMarkdown = (text: string, colors = true) => {
	let code = false;
	const rendered: string[] = [];
	for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
		if (rawLine.trimStart().startsWith("```")) {
			code = !code;
			if (!code && rendered.at(-1) === "") rendered.pop();
			continue;
		}
		if (code) {
			rendered.push(paint(`  ${rawLine}`, HARNESS_THEME.warn, colors));
			continue;
		}
		const heading = rawLine.match(/^#{1,6}\s+(.+)$/);
		if (heading) {
			rendered.push(emphasize(heading[1] ?? "", HARNESS_THEME.primary, colors));
			continue;
		}
		const bullet = rawLine.match(/^\s*[-*]\s+(.+)$/);
		if (bullet) {
			rendered.push(
				`${paint("•", HARNESS_THEME.accent, colors)} ${paint(
					inlineMarkdown(bullet[1] ?? "", colors),
					HARNESS_THEME.text,
					colors,
				)}`,
			);
			continue;
		}
		if (rawLine.startsWith(">")) {
			rendered.push(
				paint(`┊ ${rawLine.replace(/^>\s?/, "")}`, HARNESS_THEME.muted, colors),
			);
			continue;
		}
		rendered.push(
			paint(inlineMarkdown(rawLine, colors), HARNESS_THEME.text, colors),
		);
	}
	return rendered.join("\n");
};

export const renderMessage = (
	role: "user" | "assistant" | "system",
	text: string,
	colors = true,
) => {
	const identity =
		role === "user"
			? { glyph: "❯", label: "You", color: HARNESS_THEME.primary }
			: role === "assistant"
				? { glyph: "◆", label: "Agent", color: HARNESS_THEME.accent }
				: { glyph: "◈", label: "System", color: HARNESS_THEME.muted };
	const header = emphasize(
		`${identity.glyph} ${identity.label}`,
		identity.color,
		colors,
	);
	const body =
		role === "assistant"
			? renderMarkdown(text, colors)
			: paint(text, HARNESS_THEME.text, colors);
	return `${header}\n${body
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n")}`;
};

export const friendlyToolName = (name: string) =>
	name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

export const renderToolProgress = (
	step: number,
	toolName: string,
	success: boolean,
	durationMs: number,
	colors = true,
) => {
	const color = success ? HARNESS_THEME.ok : HARNESS_THEME.warn;
	const duration = `${Math.max(0.1, durationMs / 1000).toFixed(1)}s`;
	const normalized = toolName.toLowerCase();
	const glyph = !success
		? "×"
		: /log/.test(normalized)
			? "≋"
			: /deploy|build|release/.test(normalized)
				? "↗"
				: /delete|remove|destroy/.test(normalized)
					? "−"
					: /search|list|get|find|read|inspect/.test(normalized)
						? "⌕"
						: "●";
	return `  ${paint("┊", HARNESS_THEME.border, colors)} ${paint(
		glyph,
		color,
		colors,
	)} ${paint(
		`${friendlyToolName(toolName)} (${duration}) · #${step}`,
		HARNESS_THEME.muted,
		colors,
	)}`;
};

export const renderApproval = (summary: string, colors = true) => {
	const lines = [
		emphasize("⚠ Approval required", HARNESS_THEME.warn, colors),
		paint(summary, HARNESS_THEME.text, colors),
		paint(
			"This action can change your Dokploy instance.",
			HARNESS_THEME.muted,
			colors,
		),
	];
	return lines.join("\n");
};

export const renderRule = (columns = 80, colors = true) =>
	paint("─".repeat(Math.max(1, columns - 2)), HARNESS_THEME.border, colors);

export const COMMAND_HELP = `Commands
  /new                Start a fresh session
  /sessions [search]  List terminal sessions
  /resume <id|title>  Resume an older session
  /status              Show active agent and session
  /title <name>        Rename the active session
  /undo                Remove the last exchange
  /retry               Retry the last request
  /skills              List reusable agent skills
  /learn <workflow>    Teach a reusable workflow
  /clear               Clear the screen and redraw the header
  /help                Show these commands
  /exit                Close the harness

Keys
  Ctrl+C               Interrupt a running agent, or exit when idle
  Ctrl+D               Exit`;

const SPINNER_FRAMES = [
	{ glyph: "◜", face: "(｡•́︿•̀｡)" },
	{ glyph: "◠", face: "(⊙_⊙)" },
	{ glyph: "◝", face: "(•̀ᴗ•́)و" },
	{ glyph: "◞", face: "(｡•̀ᴗ-)✧" },
];

export class HarnessSpinner {
	private frame = 0;
	private timer?: NodeJS.Timeout;
	private startedAt = 0;
	private label = "Working";

	constructor(
		private readonly output: Pick<Writable, "write">,
		private readonly colors = true,
	) {}

	start(label = "Working") {
		this.stop(false);
		this.label = label;
		this.startedAt = Date.now();
		this.draw();
		this.timer = setInterval(() => {
			this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
			this.draw();
		}, 90);
	}

	update(label: string) {
		this.label = label;
		this.draw();
	}

	stop(clear = true) {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		if (clear) this.output.write("\r\u001B[2K");
	}

	finish(label = "got it!") {
		const elapsed = this.startedAt
			? `${Math.max(0.1, (Date.now() - this.startedAt) / 1000).toFixed(1)}s`
			: "0.1s";
		this.stop();
		this.output.write(
			`  ${paint("✧", HARNESS_THEME.accent, this.colors)} ${paint(
				`(ˊᗜˋ*) ${label} (${elapsed})`,
				HARNESS_THEME.muted,
				this.colors,
			)}\n`,
		);
	}

	private draw() {
		const elapsed = this.startedAt
			? ` · ${Math.max(0.1, (Date.now() - this.startedAt) / 1000).toFixed(1)}s`
			: "";
		const frame = SPINNER_FRAMES[this.frame] ?? SPINNER_FRAMES[0];
		this.output.write(
			`\r\u001B[2K  ${paint(
				frame?.glyph ?? "◜",
				HARNESS_THEME.accent,
				this.colors,
			)} ${paint(
				`${frame?.face ?? "(｡•́︿•̀｡)"} ${this.label}${elapsed}`,
				HARNESS_THEME.muted,
				this.colors,
			)}`,
		);
	}
}

/**
 * Incremental assistant renderer for the terminal harness. It writes provider
 * deltas immediately, keeps a Hermes-style live cursor, and handles the most
 * common inline markdown markers without waiting for the full response.
 */
export class HarnessStreamRenderer {
	private blockOpen = false;
	private cursorVisible = false;
	private wroteText = false;
	private bold = false;
	private code = false;
	private pendingAsterisk = "";

	constructor(
		private readonly output: Pick<Writable, "write">,
		private readonly colors = true,
		private readonly onFirstText?: () => void,
	) {}

	get hasText() {
		return this.wroteText;
	}

	push(delta: string) {
		if (!delta) return;
		this.wroteText = true;
		if (!this.blockOpen) {
			this.onFirstText?.();
			const header = emphasize("◆ Agent", HARNESS_THEME.accent, this.colors);
			this.output.write(`\n${header}\n  `);
			this.blockOpen = true;
		}
		this.clearCursor();
		this.output.write(this.formatDelta(delta));
		this.drawCursor();
	}

	pause() {
		if (!this.blockOpen) return;
		this.clearCursor();
		if (this.pendingAsterisk) {
			this.output.write(this.stylePrefix() + this.pendingAsterisk);
			this.pendingAsterisk = "";
		}
		this.output.write(`${RESET}\n`);
		this.blockOpen = false;
		this.bold = false;
		this.code = false;
	}

	finish() {
		this.pause();
		return this.wroteText;
	}

	private formatDelta(delta: string) {
		let input = this.pendingAsterisk + delta;
		this.pendingAsterisk = "";
		if (input.endsWith("*") && !input.endsWith("**")) {
			this.pendingAsterisk = "*";
			input = input.slice(0, -1);
		}

		let rendered = this.stylePrefix();
		for (let index = 0; index < input.length; index += 1) {
			if (input.startsWith("**", index)) {
				this.bold = !this.bold;
				rendered += this.stylePrefix();
				index += 1;
				continue;
			}
			const character = input[index] ?? "";
			if (character === "`") {
				this.code = !this.code;
				rendered += this.stylePrefix();
				continue;
			}
			rendered += character === "\n" ? "\n  " : character;
		}
		return rendered;
	}

	private stylePrefix() {
		if (!this.colors) return "";
		if (this.code) return `${RESET}${HARNESS_THEME.warn}`;
		if (this.bold) return `${RESET}${BOLD}${HARNESS_THEME.text}`;
		return `${RESET}${HARNESS_THEME.text}`;
	}

	private clearCursor() {
		if (!this.cursorVisible) return;
		this.output.write(" \u001B[1D");
		this.cursorVisible = false;
	}

	private drawCursor() {
		this.output.write(
			`${RESET}${paint("▍", HARNESS_THEME.accent, this.colors)}\u001B[1D`,
		);
		this.cursorVisible = true;
	}
}

export const terminalColorsEnabled = () =>
	Boolean(
		process.stdout.isTTY &&
			!process.env.NO_COLOR &&
			process.env.TERM !== "dumb",
	);

export const promptText = (colors = true) =>
	`${emphasize("❯", HARNESS_THEME.primary, colors)} `;

export const dimText = (text: string, colors = true) =>
	colors ? `${DIM}${HARNESS_THEME.muted}${text}${RESET}` : text;

export const successText = (text: string, colors = true) =>
	paint(text, HARNESS_THEME.ok, colors);

export const warningText = (text: string, colors = true) =>
	paint(text, HARNESS_THEME.warn, colors);

export const errorText = (text: string, colors = true) =>
	paint(text, HARNESS_THEME.error, colors);
