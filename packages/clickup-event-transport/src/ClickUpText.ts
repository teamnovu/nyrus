/**
 * ClickUp comments are rich text: a Quill-style array of text pieces with
 * inline attributes (bold, italic, code, link), block formats (lists, code
 * blocks) on the "\n" that ends a line, and mentions (`type: "tag"`).
 * Markdown sent as plain text mostly stays literal, so nyrus converts the
 * agent's Markdown to rich text, and comments back to Markdown for prompts.
 * Only formats the spike saw ClickUp render are written
 * (docs/nyrus/clickup-spike.md, question 3): headings become bold lines,
 * quotes italic ones, nested lists flat.
 */
import type { ClickUpRichText } from "./types.js";

/** What the agent is called in ClickUp. */
export const AGENT_NAME = "nyrus";

/**
 * First line of every comment nyrus writes. nyrus writes as a person's
 * account, so this (and the ids of the comments it posted) is how it tells
 * its own comments from that person's.
 */
export const AGENT_SIGNATURE = `🤖 ${AGENT_NAME}:`;

/** A comment starting with this addresses nyrus, like an @mention. */
export const AGENT_COMMAND = `/${AGENT_NAME}`;

const COMMAND = new RegExp(`^\\s*${AGENT_COMMAND}(?![\\w-])[:,]?[ \\t]*`, "i");

type Attributes = Record<string, unknown>;

/** Signed rich text: the signature on a line of its own, then the comment. */
export function signed(comment: ClickUpRichText[]): ClickUpRichText[] {
	return [
		{ text: AGENT_SIGNATURE, attributes: { bold: true } },
		{ text: "\n" },
		...comment,
	];
}

/** Only the first line counts: a user may quote one of nyrus's comments. */
export function isSigned(text: string | undefined | null): boolean {
	return (
		text
			?.trimStart()
			.split(/\r?\n/, 1)[0]
			?.trim()
			.startsWith(AGENT_SIGNATURE) ?? false
	);
}

/** Whether a comment (Markdown or plain text) addresses nyrus, and its text without the command. */
export function parseCommand(text: string): {
	addressed: boolean;
	body: string;
} {
	const match = COMMAND.exec(text);
	if (!match) {
		return { addressed: false, body: text.trim() };
	}
	return { addressed: true, body: text.slice(match[0].length).trim() };
}

// ---------------------------------------------------------------------------
// Markdown → rich text
// ---------------------------------------------------------------------------

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/;
const ORDERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** A line's pieces, and the block format on its "\n". */
interface LineFormat {
	pieces: ClickUpRichText[];
	line?: Attributes;
}

/** Block formats, tried in order; a line matching none is a paragraph. Null drops the line. */
const LINE_FORMATS: Array<{
	pattern: RegExp;
	write: (match: RegExpExecArray) => LineFormat | null;
}> = [
	{
		pattern: HEADING,
		write: (m) => ({ pieces: inline(m[1]!, { bold: true }) }),
	},
	{ pattern: RULE, write: () => ({ pieces: [] }) },
	{
		pattern: BULLET,
		write: (m) => ({
			pieces: inline(checkbox(m[1]) + m[2]!),
			line: { list: { list: "bullet" } },
		}),
	},
	{
		pattern: ORDERED,
		write: (m) => ({
			pieces: inline(m[1]!),
			line: { list: { list: "ordered" } },
		}),
	},
	{
		pattern: QUOTE,
		write: (m) => ({ pieces: inline(m[1]!, { italic: true }) }),
	},
	// Table rows stay as text; their separator row would only be noise.
	{ pattern: TABLE_SEPARATOR, write: () => null },
];

function checkbox(box: string | undefined): string {
	return box === undefined ? "" : box === " " ? "☐ " : "☑ ";
}

/** Markdown (what the agent writes) to ClickUp rich text. */
export function markdownToRichText(markdown: string): ClickUpRichText[] {
	const ops: ClickUpRichText[] = [];
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const newline = (attributes?: Attributes) =>
		ops.push(attributes ? { text: "\n", attributes } : { text: "\n" });

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const fence = FENCE.exec(line);
		if (fence) {
			const close = fence[1]!;
			const block = { "code-block": { "code-block": fence[2] || "plain" } };
			let n = i + 1;
			for (; n < lines.length; n++) {
				const candidate = lines[n]!.trim();
				if (
					candidate.startsWith(close) &&
					/^[`~]*$/.test(candidate) &&
					candidate[0] === close[0]
				) {
					break;
				}
				if (lines[n]) ops.push({ text: lines[n]! });
				newline(block);
			}
			if (n === i + 1) newline(block);
			i = n;
			continue;
		}

		const formatted = LINE_FORMATS.find(({ pattern }) => pattern.test(line));
		const format = formatted
			? formatted.write(formatted.pattern.exec(line)!)
			: { pieces: inline(line) };
		if (format) {
			ops.push(...format.pieces);
			newline(format.line);
		}
	}

	// Drop trailing empty lines.
	while (
		ops.length > 1 &&
		isPlainNewline(ops.at(-1)) &&
		isPlainNewline(ops.at(-2))
	) {
		ops.pop();
	}
	if (ops.length === 1 && isPlainNewline(ops[0])) ops.pop();
	return ops;
}

function isPlainNewline(op: ClickUpRichText | undefined): boolean {
	return op?.text === "\n" && !op.attributes;
}

const SPECIAL = "\\`[<*_~";
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~|>]/;
const CODE = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const LINK = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/;
const AUTOLINK = /^<(https?:\/\/[^>\s]+)>/;
const STRONG = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/;
const STRIKE = /^~~(?=\S)([\s\S]*?\S)~~/;
const EMPHASIS = /^([*_])(?=\S)([\s\S]*?\S)\1(?![*_\w])/;

/** Inline formats, by the character they start with, tried in order. */
const INLINE_FORMATS: Array<{
	starts: string;
	pattern: RegExp;
	write: (match: RegExpExecArray, attributes: Attributes) => ClickUpRichText[];
}> = [
	{
		starts: "`",
		pattern: CODE,
		write: (m, a) => [piece(m[2]!, { ...a, code: true })],
	},
	{
		starts: "[",
		pattern: LINK,
		write: (m, a) => inline(m[1]!, { ...a, link: m[2] }),
	},
	{
		starts: "<",
		pattern: AUTOLINK,
		write: (m, a) => [piece(m[1]!, { ...a, link: m[1] })],
	},
	{
		starts: "*_",
		pattern: STRONG,
		write: (m, a) => inline(m[2]!, { ...a, bold: true }),
	},
	{
		starts: "~",
		pattern: STRIKE,
		write: (m, a) => inline(m[1]!, { ...a, strike: true }),
	},
	{
		starts: "*_",
		pattern: EMPHASIS,
		write: (m, a) => inline(m[2]!, { ...a, italic: true }),
	},
];

/** One line's inline Markdown as rich text pieces. */
function inline(text: string, attributes: Attributes = {}): ClickUpRichText[] {
	const ops: ClickUpRichText[] = [];
	let buffer = "";
	const flush = () => {
		if (buffer) ops.push(piece(buffer, attributes));
		buffer = "";
	};

	for (let i = 0; i < text.length; ) {
		const char = text[i]!;
		if (!SPECIAL.includes(char)) {
			buffer += char;
			i++;
			continue;
		}
		if (char === "\\" && ESCAPABLE.test(text[i + 1] ?? "")) {
			buffer += text[i + 1];
			i += 2;
			continue;
		}
		const rest = text.slice(i);
		// snake_case_words stay as they are
		const intraword = char === "_" && /\w/.test(text[i - 1] ?? "");
		let consumed = 0;
		for (const { starts, pattern, write } of intraword ? [] : INLINE_FORMATS) {
			if (!starts.includes(char)) continue;
			const match = pattern.exec(rest);
			if (match) {
				flush();
				ops.push(...write(match, attributes));
				consumed = match[0].length;
				break;
			}
		}
		if (consumed > 0) {
			i += consumed;
		} else {
			buffer += char;
			i++;
		}
	}
	flush();
	return ops;
}

function piece(text: string, attributes: Attributes): ClickUpRichText {
	return Object.keys(attributes).length > 0
		? { text, attributes: { ...attributes } }
		: { text };
}

/** A mention of a ClickUp user, which notifies them. */
export function mention(userId: number): ClickUpRichText {
	return { type: "tag", user: { id: userId } };
}

// ---------------------------------------------------------------------------
// Rich text → Markdown
// ---------------------------------------------------------------------------

interface Line {
	text: string;
	attributes?: Attributes;
}

/** A comment's rich text as Markdown, for prompts. */
export function richTextToMarkdown(comment: ClickUpRichText[]): string {
	const lines: Line[] = [];
	let current = "";
	for (const op of comment) {
		if (op.type === "tag" && op.user) {
			current += `@${op.user.username || op.user.email || op.user.id}`;
			continue;
		}
		if (typeof op.text !== "string") continue;
		const parts = op.text.split("\n");
		parts.forEach((part, index) => {
			current += formatInline(part, op.attributes);
			if (index < parts.length - 1) {
				lines.push({ text: current, attributes: op.attributes });
				current = "";
			}
		});
	}
	if (current) lines.push({ text: current });

	const out: string[] = [];
	let ordered = 0;
	for (let i = 0; i < lines.length; i++) {
		const { text, attributes } = lines[i]!;
		const code = codeLanguage(attributes);
		if (code !== undefined) {
			const block: string[] = [];
			for (
				;
				i < lines.length && codeLanguage(lines[i]!.attributes) !== undefined;
				i++
			) {
				block.push(lines[i]!.text);
			}
			i--;
			out.push(`\`\`\`${code === "plain" ? "" : code}`, ...block, "```");
			ordered = 0;
			continue;
		}
		const list = listType(attributes);
		ordered = list === "ordered" ? ordered + 1 : 0;
		const header = Number(attributes?.header) || 0;
		out.push(
			list === "bullet"
				? `- ${text}`
				: list === "ordered"
					? `${ordered}. ${text}`
					: list === "checked"
						? `- [x] ${text}`
						: list === "unchecked"
							? `- [ ] ${text}`
							: header > 0
								? `${"#".repeat(Math.min(header, 6))} ${text}`
								: attributes?.blockquote
									? `> ${text}`
									: text,
		);
	}
	return out.join("\n").trim();
}

/** Inline attributes as Markdown; whitespace-only text stays plain. */
function formatInline(text: string, attributes?: Attributes): string {
	if (!text.trim() || !attributes) return text;
	let result = text;
	if (attributes.code) result = `\`${result}\``;
	if (attributes.bold) result = `**${result}**`;
	if (attributes.italic) result = `_${result}_`;
	if (attributes.strike) result = `~~${result}~~`;
	if (typeof attributes.link === "string")
		result = `[${result}](${attributes.link})`;
	return result;
}

function codeLanguage(attributes?: Attributes): string | undefined {
	const block = attributes?.["code-block"];
	if (!block) return undefined;
	if (typeof block === "object") {
		const language = (block as Record<string, unknown>)["code-block"];
		return typeof language === "string" ? language : "plain";
	}
	return typeof block === "string" ? block : "plain";
}

function listType(attributes?: Attributes): string | undefined {
	const list = attributes?.list;
	if (!list) return undefined;
	if (typeof list === "string") return list;
	const value = (list as Record<string, unknown>).list;
	return typeof value === "string" ? value : undefined;
}

/** The text of rich text, without formatting. */
export function plainText(comment: ClickUpRichText[]): string {
	return comment
		.map((op) =>
			op.type === "tag" && op.user
				? `@${op.user.username || op.user.id}`
				: typeof op.text === "string"
					? op.text
					: "",
		)
		.join("");
}
