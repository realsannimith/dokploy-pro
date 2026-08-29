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
	const row = (label: string, value: string) => {
		const plain = `  ${label.padEnd(13)}${value}`;
		const fitted = clip(plain, inner).padEnd(inner);
		return `${paint("│", HARNESS_THEME.border, colors)}${paint(
			fitted,
			HARNESS_THEME.text,
			colors,
		)}${paint("│", HARNESS_THEME.border, colors)}`;
	};
	const title = " SESSION ";
	const top = `╭─${title}${"─".repeat(Math.max(0, width - title.length - 3))}╮`;
	return [
		paint(top, HARNESS_THEME.border, colors),
		row("Agent", data.agent),
		row("Organization", data.organization),
		row("Model", data.model),
		row("Session", data.session),
		row(
			"Capabilities",
			`${data.tools} tools · ${data.skills} skills · ${data.memories} memories`,
		),
		paint(`╰${"─".repeat(inner)}╯`, HARNESS_THEME.border, colors),
	].join("\n");
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
	return `${paint(success ? "●" : "▲", color, colors)} ${paint(
		`Step ${step} · ${friendlyToolName(toolName)} · ${duration}`,
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

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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

	private draw() {
		const elapsed = this.startedAt
			? ` · ${Math.max(0.1, (Date.now() - this.startedAt) / 1000).toFixed(1)}s`
			: "";
		this.output.write(
			`\r\u001B[2K${paint(
				SPINNER_FRAMES[this.frame] ?? "⠋",
				HARNESS_THEME.accent,
				this.colors,
			)} ${paint(`${this.label}${elapsed}`, HARNESS_THEME.muted, this.colors)}`,
		);
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
