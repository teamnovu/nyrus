import { describe, expect, it } from "vitest";
import {
	isSigned,
	markdownToRichText,
	parseCommand,
	richTextToMarkdown,
	signed,
} from "../src/ClickUpText.js";

const bullet = { list: { list: "bullet" } };
const ordered = { list: { list: "ordered" } };

describe("markdownToRichText", () => {
	it("writes inline formats as attributes and block formats on the newline", () => {
		expect(
			markdownToRichText(
				"Fixed **the menu** in _header.vue_, see `npm test` and [PR #20](https://github.com/teamnovu/nyrus/pull/20).\n\n- first\n- second\n1. step one\n\n```js\nconst x = 1;\n\nx++;\n```",
			),
		).toEqual([
			{ text: "Fixed " },
			{ text: "the menu", attributes: { bold: true } },
			{ text: " in " },
			{ text: "header.vue", attributes: { italic: true } },
			{ text: ", see " },
			{ text: "npm test", attributes: { code: true } },
			{ text: " and " },
			{
				text: "PR #20",
				attributes: { link: "https://github.com/teamnovu/nyrus/pull/20" },
			},
			{ text: "." },
			{ text: "\n" },
			{ text: "\n" },
			{ text: "first" },
			{ text: "\n", attributes: bullet },
			{ text: "second" },
			{ text: "\n", attributes: bullet },
			{ text: "step one" },
			{ text: "\n", attributes: ordered },
			{ text: "\n" },
			{ text: "const x = 1;" },
			{ text: "\n", attributes: { "code-block": { "code-block": "js" } } },
			{ text: "\n", attributes: { "code-block": { "code-block": "js" } } },
			{ text: "x++;" },
			{ text: "\n", attributes: { "code-block": { "code-block": "js" } } },
		]);
	});

	it("writes headings bold, quotes italic, checkboxes as symbols, and drops table separators", () => {
		expect(
			markdownToRichText(
				"## Summary\n> quoted\n- [x] done\n- [ ] open\n| a | b |\n|---|---|\n| 1 | 2 |",
			),
		).toEqual([
			{ text: "Summary", attributes: { bold: true } },
			{ text: "\n" },
			{ text: "quoted", attributes: { italic: true } },
			{ text: "\n" },
			{ text: "☑ done" },
			{ text: "\n", attributes: bullet },
			{ text: "☐ open" },
			{ text: "\n", attributes: bullet },
			{ text: "| a | b |" },
			{ text: "\n" },
			{ text: "| 1 | 2 |" },
			{ text: "\n" },
		]);
	});

	it("keeps snake_case, escapes and unclosed markers as text", () => {
		expect(
			markdownToRichText("use snake_case_name, \\*not bold\\* and 2 * 3"),
		).toEqual([
			{ text: "use snake_case_name, *not bold* and 2 * 3" },
			{ text: "\n" },
		]);
	});

	it("nests bold inside links and links inside bold", () => {
		expect(markdownToRichText("**see [docs](https://x.y)**")).toEqual([
			{ text: "see ", attributes: { bold: true } },
			{ text: "docs", attributes: { bold: true, link: "https://x.y" } },
			{ text: "\n" },
		]);
	});

	it("drops trailing empty lines and gives nothing for an empty text", () => {
		expect(markdownToRichText("done\n\n\n")).toEqual([
			{ text: "done" },
			{ text: "\n" },
		]);
		expect(markdownToRichText("")).toEqual([]);
	});

	it("handles a long line of unclosed markers quickly", () => {
		const started = Date.now();
		markdownToRichText(`${"*a ".repeat(5000)}\n${"`".repeat(5000)}`);
		expect(Date.now() - started).toBeLessThan(2000);
	});
});

describe("richTextToMarkdown", () => {
	it("reads what markdownToRichText writes back", () => {
		const markdown =
			"Fixed **the menu**, see `npm test` and [PR](https://x.y).\n- first\n- second\n1. one\n2. two\n```js\nconst x = 1;\n```";
		expect(richTextToMarkdown(markdownToRichText(markdown))).toBe(markdown);
	});

	it("reads mentions, headers, quotes and checklists from ClickUp's editor", () => {
		expect(
			richTextToMarkdown([
				{ text: "Title" },
				{ text: "\n", attributes: { header: 2 } },
				{ type: "tag", user: { id: 42, username: "Simon" } },
				{ text: " please check\n" },
				{ text: "quote" },
				{ text: "\n", attributes: { blockquote: true } },
				{ text: "task" },
				{ text: "\n", attributes: { list: { list: "unchecked" } } },
			]),
		).toBe("## Title\n@Simon please check\n> quote\n- [ ] task");
	});
});

describe("signature and command", () => {
	it("signs on a line of its own and recognizes the signature on the first line only", () => {
		const ops = signed([{ text: "Done." }, { text: "\n" }]);
		expect(ops.slice(0, 2)).toEqual([
			{ text: "🤖 nyrus:", attributes: { bold: true } },
			{ text: "\n" },
		]);
		const text = ops.map((op) => op.text).join("");
		expect(isSigned(text)).toBe(true);
		expect(isSigned(`Quote:\n${text}`)).toBe(false);
		expect(isSigned(undefined)).toBe(false);
	});

	it("reads /nyrus at the start, in any case, and strips it", () => {
		expect(parseCommand("/nyrus why is the menu broken?")).toEqual({
			addressed: true,
			body: "why is the menu broken?",
		});
		expect(parseCommand("  /NYRUS: stop")).toEqual({
			addressed: true,
			body: "stop",
		});
		expect(parseCommand("ask /nyrus later")).toEqual({
			addressed: false,
			body: "ask /nyrus later",
		});
		expect(parseCommand("/nyrusbot hi").addressed).toBe(false);
	});
});
