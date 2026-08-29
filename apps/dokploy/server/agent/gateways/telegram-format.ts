/**
 * Telegram only understands its own MarkdownV2 dialect, and it rejects the
 * whole message when a reserved character is left unescaped. Models answer in
 * regular markdown, so everything sent to a chat is translated here first.
 */

const RESERVED = /[_*[\]()~`>#+\-=|{}.!\\]/g;

const escapeText = (value: string) => value.replace(RESERVED, "\\$&");

/** Inside code entities only the backslash and the backtick are special. */
const escapeCode = (value: string) => value.replace(/[\\`]/g, "\\$&");

const escapeUrl = (value: string) => value.replace(/[\\)]/g, "\\$&");

const INLINE_SOURCE = [
	"(`+)([\\s\\S]+?)\\1",
	"\\*\\*\\*(?!\\s)([\\s\\S]+?)(?<!\\s)\\*\\*\\*",
	"\\*\\*(?!\\s)([\\s\\S]+?)(?<!\\s)\\*\\*",
	"__(?!\\s)([\\s\\S]+?)(?<!\\s)__",
	"~~(?!\\s)([\\s\\S]+?)(?<!\\s)~~",
	'!?\\[([^\\]]*)\\]\\(\\s*((?:[^()\\s]|\\([^()\\s]*\\))+)(?:\\s+"[^"]*")?\\s*\\)',
	"(?<![\\w*])\\*(?!\\s)([^*\\n]+?)(?<!\\s)\\*(?![\\w*])",
	"(?<![\\w_])_(?!\\s)([^_\\n]+?)(?<!\\s)_(?![\\w_])",
].join("|");

const renderInline = (value: string): string => {
	// A fresh regex per call: renderInline recurses and would otherwise fight
	// over lastIndex with its own nested calls.
	const pattern = new RegExp(INLINE_SOURCE, "g");
	let result = "";
	let index = 0;
	let match = pattern.exec(value);
	while (match) {
		result += escapeText(value.slice(index, match.index));
		index = match.index + match[0].length;
		const [
			,
			,
			code,
			boldItalic,
			bold,
			altBold,
			strike,
			linkText,
			linkUrl,
			starItalic,
			underscoreItalic,
		] = match;
		if (code !== undefined) result += `\`${escapeCode(code)}\``;
		else if (boldItalic !== undefined)
			result += `*_${renderInline(boldItalic)}_*`;
		else if (bold !== undefined) result += `*${renderInline(bold)}*`;
		else if (altBold !== undefined) result += `*${renderInline(altBold)}*`;
		else if (strike !== undefined) result += `~${renderInline(strike)}~`;
		else if (linkUrl !== undefined)
			result += `[${renderInline(linkText ?? "")}](${escapeUrl(linkUrl)})`;
		else if (starItalic !== undefined)
			result += `_${renderInline(starItalic)}_`;
		else if (underscoreItalic !== undefined)
			result += `_${renderInline(underscoreItalic)}_`;
		match = pattern.exec(value);
	}
	return result + escapeText(value.slice(index));
};

const renderLine = (line: string): string => {
	if (!line.trim()) return "";
	if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) return "—";

	const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
	if (heading) {
		const content = (heading[2] ?? "").replace(/\s+#+\s*$/, "").trim();
		return content ? `*${renderInline(content)}*` : "";
	}

	const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
	if (quote) return `>${renderLine(quote[1] ?? "")}`;

	const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
	if (bullet) return `${bullet[1]}• ${renderInline(bullet[2] ?? "")}`;

	return renderInline(line);
};

/** Translate regular markdown into the MarkdownV2 subset Telegram renders. */
export const toTelegramMarkdown = (input: string): string => {
	const lines = (input ?? "").replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];
	let language: string | null = null;
	let code: string[] = [];

	const closeBlock = () => {
		const body = escapeCode(code.join("\n").replace(/\n+$/, ""));
		out.push(`\`\`\`${language}\n${body}\n\`\`\``);
		language = null;
		code = [];
	};

	for (const line of lines) {
		const fence = /^\s*```(.*)$/.exec(line);
		if (language !== null) {
			if (fence) closeBlock();
			else code.push(line);
			continue;
		}
		if (fence) {
			language = /^[\w+#.-]*/.exec((fence[1] ?? "").trim())?.[0] ?? "";
			continue;
		}
		out.push(renderLine(line));
	}
	// An unterminated fence still has to produce a balanced entity.
	if (language !== null) closeBlock();

	return out.join("\n").trim();
};

/** Undo the escaping so a rejected message can still be delivered as text. */
export const stripTelegramMarkdown = (text: string) =>
	text.replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, "$1");

const hardSplit = (line: string, limit: number) => {
	const parts: string[] = [];
	for (let i = 0; i < line.length; i += limit)
		parts.push(line.slice(i, i + limit));
	return parts;
};

/**
 * Telegram caps a message at 4096 characters and parses each one on its own,
 * so chunks are cut on line boundaries and any open code fence is closed and
 * reopened instead of being split in half.
 */
export const splitTelegramMarkdown = (text: string, limit = 3800): string[] => {
	const chunks: string[] = [];
	let current: string[] = [];
	let length = 0;
	let openFence: string | null = null;

	const append = (line: string) => {
		length += current.length > 0 ? line.length + 1 : line.length;
		current.push(line);
	};
	const flush = () => {
		if (current.length === 0) return;
		chunks.push(current.join("\n"));
		current = [];
		length = 0;
	};

	for (const rawLine of text.split("\n")) {
		for (const line of rawLine.length > limit
			? hardSplit(rawLine, limit)
			: [rawLine]) {
			const projected =
				length + (current.length > 0 ? line.length + 1 : line.length);
			if (projected > limit && current.length > 0) {
				if (openFence) append("```");
				flush();
				if (openFence) append(openFence);
			}
			append(line);
			if (/^```/.test(line)) openFence = openFence ? null : line;
		}
	}
	flush();

	return chunks.filter((chunk) => chunk.trim().length > 0);
};
