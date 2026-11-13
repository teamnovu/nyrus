/**
 * Jira's REST API v2 stores descriptions and comments as wiki markup; Cyrus
 * reads Markdown-ish text and writes Markdown. Both conversions cover what
 * issues and agent answers commonly use (headings, emphasis, code, links,
 * lists, quotes, tables), not every corner of either syntax.
 *
 * @see https://jira.atlassian.com/secure/WikiRendererHelpAction.jspa?section=all
 */

/** What the agent is called in Jira: novu's name for its Cyrus. */
export const AGENT_NAME = "Nyrus";

/**
 * First line of every comment Cyrus writes. Webhooks for those comments come
 * back to Cyrus like anyone else's, and the agent account may be a person's
 * own account, so this is how Cyrus tells its comments from the user's.
 */
export const AGENT_SIGNATURE = `🤖 *${AGENT_NAME}*`;

/** "@Nyrus" written as text, for comments that don't use a real mention. */
const NAME_MENTION = new RegExp(`(^|\\s)@${AGENT_NAME}\\b`, "i");
const NAME_MENTION_PREFIX = new RegExp(`(^|\\s)@${AGENT_NAME}\\b[:,]?`, "gi");

export function signed(wiki: string): string {
	return wiki ? `${AGENT_SIGNATURE}\n${wiki}` : AGENT_SIGNATURE;
}

/** Only the first line counts: a user may quote one of Nyrus's comments. */
export function isSigned(body: string | undefined | null): boolean {
	return body?.split(/\r?\n/, 1)[0]?.trim() === AGENT_SIGNATURE;
}

export function mentionMarkup(accountId: string): string {
	return `[~accountid:${accountId}]`;
}

/** True if a comment (wiki markup) mentions the agent account, or says "@Nyrus". */
export function mentionsAgent(body: string, agentAccountId: string): boolean {
	return (
		body.includes(mentionMarkup(agentAccountId)) || NAME_MENTION.test(body)
	);
}

/** The comment's text for a prompt: Markdown, without the mention of the agent. */
export function promptFromComment(
	body: string,
	agentAccountId: string,
): string {
	return wikiToMarkdown(
		body
			.split(mentionMarkup(agentAccountId))
			.join("")
			.replace(NAME_MENTION_PREFIX, "$1"),
	);
}

// ---------------------------------------------------------------------------
// Wiki markup → Markdown
// ---------------------------------------------------------------------------

/** Pieces set aside during a conversion are marked \uE000<index>\uE000. */
function restore(text: string, kept: string[]): string {
	let result = text;
	// Kept pieces can contain placeholders themselves (e.g. code in a link).
	for (let i = 0; i < 5 && /\uE000\d+\uE000/.test(result); i++) {
		result = result.replace(
			/\uE000(\d+)\uE000/g,
			(_m, index: string) => kept[Number(index)] ?? "",
		);
	}
	return result;
}

/**
 * Wiki markup (what Jira stores) to Markdown (what goes into prompts).
 * `mentionName` names mentioned accounts; unknown ones become "@user".
 */
export function wikiToMarkdown(
	wiki: string,
	mentionName?: (accountId: string) => string | undefined,
): string {
	if (!wiki) {
		return "";
	}
	const kept: string[] = [];
	const keep = (piece: string) => `\uE000${kept.push(piece) - 1}\uE000`;
	let text = wiki.replace(/\r\n?/g, "\n");

	text = text.replace(
		/\{code(?::([^}]*))?\}([\s\S]*?)\{code\}/g,
		(_m, params: string | undefined, body: string) => {
			const language = (params ?? "").split("|")[0]?.trim() ?? "";
			const lang = language.includes("=") ? "" : language;
			return keep(`\`\`\`${lang}\n${trimBlankLines(body)}\n\`\`\``);
		},
	);
	text = text.replace(
		/\{noformat(?::[^}]*)?\}([\s\S]*?)\{noformat\}/g,
		(_m, body: string) => keep(`\`\`\`\n${trimBlankLines(body)}\n\`\`\``),
	);
	text = text.replace(/\{quote\}([\s\S]*?)\{quote\}/g, (_m, body: string) =>
		body
			.trim()
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n"),
	);
	text = replaceMonospace(text, (code) => keep(`\`${code}\``));
	text = text.replace(
		/\[~accountid:([^\]]+)\]/g,
		(_m, id: string) => `@${mentionName?.(id) ?? "user"}`,
	);
	// [label|url], or [label|url|smart-link] as the Jira editor saves pasted links
	text = text.replace(
		/\[([^\]|\n]+)\|([^\]|\n]+)(?:\|[^\]\n]*)?\]/g,
		(_m, label: string, url: string) => keep(`[${label}](${url.trim()})`),
	);
	text = text.replace(/\[((?:https?|mailto):[^\]\s]+)\]/g, (_m, url: string) =>
		keep(url),
	);

	text = text
		.split("\n")
		.map((line) => {
			const heading = /^h([1-6])\.\s+(.*)$/.exec(line);
			if (heading) {
				return `${"#".repeat(Number(heading[1]))} ${heading[2]}`;
			}
			if (/^bq\.\s+/.test(line)) {
				return line.replace(/^bq\.\s+/, "> ");
			}
			const item = /^(\*+|#+|-)\s+(.*)$/.exec(line);
			if (item) {
				const marker = item[1]!;
				const depth = marker === "-" ? 1 : marker.length;
				const bullet = marker.startsWith("#") ? "1." : "-";
				return `${"  ".repeat(depth - 1)}${bullet} ${item[2]}`;
			}
			if (line.startsWith("||")) {
				const cells = line.replace(/^\|\||\|\|\s*$/g, "").split("||");
				return `| ${cells.join(" | ")} |\n|${cells.map(() => " --- ").join("|")}|`;
			}
			if (line.trim() === "----") {
				return "---";
			}
			return line;
		})
		.join("\n");

	// *bold* → **bold** (list markers were converted above)
	text = text.replace(
		/(^|[^\w*\\])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/gm,
		"$1**$2**",
	);
	// Escaped characters
	text = text.replace(/\\([{}[\]*_|-])/g, "$1");

	// Collapse blank lines before code blocks are put back, so their content stays as it is.
	return restore(text.replace(/\n{3,}/g, "\n\n"), kept).trim();
}

function trimBlankLines(text: string): string {
	return text.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
}

// ---------------------------------------------------------------------------
// Markdown → wiki markup
// ---------------------------------------------------------------------------

/** Languages Jira's {code} macro highlights; anything else becomes {noformat}. */
const CODE_LANGUAGES = new Set([
	"actionscript",
	"ada",
	"applescript",
	"bash",
	"c",
	"c#",
	"c++",
	"cpp",
	"css",
	"erlang",
	"go",
	"groovy",
	"haskell",
	"html",
	"java",
	"javascript",
	"json",
	"lua",
	"objc",
	"perl",
	"php",
	"python",
	"r",
	"ruby",
	"scala",
	"sql",
	"swift",
	"visualbasic",
	"xml",
	"yaml",
]);

const LANGUAGE_ALIASES: Record<string, string> = {
	js: "javascript",
	jsx: "javascript",
	ts: "javascript",
	tsx: "javascript",
	typescript: "javascript",
	mjs: "javascript",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	console: "bash",
	yml: "yaml",
	py: "python",
	rb: "ruby",
	csharp: "c#",
	cs: "c#",
	kotlin: "java",
	vue: "html",
	twig: "html",
	blade: "html",
	antlers: "html",
	scss: "css",
};

function codeBlock(body: string, lang: string): string {
	const key = lang.trim().toLowerCase();
	const language = LANGUAGE_ALIASES[key] ?? key;
	return CODE_LANGUAGES.has(language)
		? `{code:${language}}\n${body}\n{code}`
		: `{noformat}\n${body}\n{noformat}`;
}

/** Braces start macros and brackets start links in wiki markup. */
function escapeWiki(text: string): string {
	return text.replace(/[{}[\]]/g, (c) => `\\${c}`);
}

/** Markdown (what the agent writes) to wiki markup (what Jira renders). */
export function markdownToWiki(markdown: string): string {
	if (!markdown.trim()) {
		return "";
	}
	const kept: string[] = [];
	const keep = (piece: string) => `\uE000${kept.push(piece) - 1}\uE000`;
	let text = markdown.replace(/\r\n?/g, "\n");

	// Code first: nothing inside it is converted.
	text = text.replace(
		/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm,
		(_m, _fence, info: string, body: string) =>
			keep(codeBlock(body, info.trim().split(/\s+/)[0] ?? "")),
	);
	// Inline code runs from a run of backticks to the next run of the same
	// length, so it can contain shorter runs: ``a`b`` is a`b.
	text = text.replace(
		/(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g,
		(_m, _ticks: string, code: string) => {
			// "`` `a` ``": one space on each side only separates the backticks.
			const content =
				/^ .* $/.test(code) && code.trim() ? code.slice(1, -1) : code;
			return keep(`{{${content.replace(/[{}]/g, (c) => `\\${c}`)}}}`);
		},
	);

	// Links and images.
	text = text.replace(
		/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
		(_m, url: string) => keep(`!${url}!`),
	);
	text = text.replace(
		/\[([^\]]+)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g,
		(_m, label: string, url: string) =>
			keep(`[${label.replace(/[|[\]]/g, "")}|${url}]`),
	);
	text = text.replace(/<((?:https?|mailto):[^>\s]+)>/g, (_m, url: string) =>
		keep(`[${url}]`),
	);

	// Block syntax, line by line. Markers are kept so escaping skips them.
	const lines = text.split("\n");
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!.replace(/\t/g, "  ");
		const next = lines[i + 1];

		if (isTableRow(line)) {
			const cells = tableCells(line);
			// Only a table's first row can be a header, and only if every cell
			// of the next row is a separator: "| --- | pending |" is data.
			const firstRow = i === 0 || !isTableRow(lines[i - 1]!);
			if (firstRow && next !== undefined && isSeparatorRow(next)) {
				out.push(`${keep("||")}${cells.join(keep("||"))}${keep("||")}`);
				i++; // the separator row
			} else {
				out.push(`${keep("|")}${cells.join(keep("|"))}${keep("|")}`);
			}
			continue;
		}

		// Closing hashes count only after a space: "# C#" keeps its "#".
		const heading = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
		if (heading) {
			out.push(`${keep(`h${heading[1]!.length}. `)}${heading[2]}`);
			continue;
		}
		if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
			out.push(keep("----"));
			continue;
		}
		const quote = /^\s*>\s?(.*)$/.exec(line);
		if (quote) {
			out.push(quote[1] ? `${keep("bq. ")}${quote[1]}` : "");
			continue;
		}
		const task = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
		if (task) {
			const depth = Math.floor(task[1]!.length / 2) + 1;
			const box = task[2] === " " ? "☐" : "☑";
			out.push(`${keep(`${"*".repeat(depth)} ${box} `)}${task[3]}`);
			continue;
		}
		const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
		if (bullet) {
			const depth = Math.floor(bullet[1]!.length / 2) + 1;
			out.push(`${keep(`${"*".repeat(depth)} `)}${bullet[2]}`);
			continue;
		}
		const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
		if (numbered) {
			const depth = Math.floor(numbered[1]!.length / 2) + 1;
			out.push(`${keep(`${"#".repeat(depth)} `)}${numbered[2]}`);
			continue;
		}
		out.push(line);
	}
	text = out.join("\n");

	// Inline emphasis: **bold** / __bold__ → *bold*, *italic* → _italic_,
	// ~~strike~~ → -strike-.
	text = text.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "\uE001$1\uE001");
	text = text.replace(/__(?=\S)([^\n]*?\S)__/g, "\uE001$1\uE001");
	text = text.replace(
		/(^|[^\w*\\])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/gm,
		"$1_$2_",
	);
	text = text.replace(/~~(?=\S)([^~\n]*?\S)~~/g, "-$1-");
	text = escapeWiki(text).replace(/\uE001/g, "*");

	return restore(text, kept).trim();
}

function isTableRow(line: string): boolean {
	return /^\s*\|.*\|\s*$/.test(line);
}

function tableCells(line: string): string[] {
	return line
		.trim()
		.replace(/^\||\|$/g, "")
		.split("|")
		.map((cell) => cell.trim());
}

/**
 * A Markdown table's header separator: every cell like "---", ":--" or
 * "--:". The outer pipes are optional ("--- | ---" is a separator too).
 */
function isSeparatorRow(line: string): boolean {
	return (
		line.includes("-") &&
		tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell))
	);
}

/**
 * Replace every `{{monospace}}` span on a line with `render(content)`.
 *
 * markdownToWiki escapes braces in code (`a}` is `{{a\}}}`), but not
 * backslashes, so `\}}` is ambiguous: an escaped `}` plus more, or a
 * backslash at the end of the code. Read it as the end of the span unless
 * another `}` follows: `{{a\}}}` is `a}`, `{{C:\}} and {{b}}` is `C:\` and
 * `b`. A scan instead of a regex, so no input can make it backtrack: each
 * line is read once, and a span that isn't closed on its line stays as is.
 */
function replaceMonospace(
	text: string,
	render: (code: string) => string,
): string {
	return text
		.split("\n")
		.map((line) => {
			let out = "";
			let i = 0;
			while (i < line.length) {
				const start = line.indexOf("{{", i);
				if (start < 0) break;
				let code = "";
				let end = -1;
				for (let j = start + 2; j < line.length; j++) {
					const c = line[j]!;
					if (c === "\\" && line[j + 1] === "{") {
						code += "{";
						j++;
					} else if (c === "\\" && line[j + 1] === "}") {
						if (line[j + 2] === "}" && line[j + 3] !== "}") {
							code += "\\"; // a trailing backslash, then the end
						} else {
							code += "}";
							j++;
						}
					} else if (c === "}" && line[j + 1] === "}") {
						end = j;
						break;
					} else {
						code += c;
					}
				}
				if (end < 0) {
					// Not closed on this line: no later span closes either.
					break;
				}
				// "{{}}" is no code; keep it as written.
				out +=
					line.slice(i, start) +
					(code ? render(code) : line.slice(start, end + 2));
				i = end + 2;
			}
			return out + line.slice(i);
		})
		.join("\n");
}
