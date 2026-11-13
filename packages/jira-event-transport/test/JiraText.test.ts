import { describe, expect, it } from "vitest";
import {
	isSigned,
	markdownToWiki,
	mentionsAgent,
	promptFromComment,
	signed,
	wikiToMarkdown,
} from "../src/JiraText.js";

describe("markdownToWiki", () => {
	it("converts headings, emphasis, code and links", () => {
		expect(
			markdownToWiki(
				[
					"## Summary",
					"Fixed the **mobile menu** in *Header.vue*, see [PR #20](https://github.com/x/y/pull/20).",
					"Run `pnpm test` before ~~merging~~ deploying.",
				].join("\n"),
			),
		).toBe(
			[
				"h2. Summary",
				"Fixed the *mobile menu* in _Header.vue_, see [PR #20|https://github.com/x/y/pull/20].",
				"Run {{pnpm test}} before -merging- deploying.",
			].join("\n"),
		);
	});

	it("keeps code blocks verbatim, with a language Jira knows", () => {
		expect(
			markdownToWiki(
				"```ts\nconst a = { b: [1] };\n```\n\n```twigx\n{{ x }}\n```",
			),
		).toBe(
			"{code:javascript}\nconst a = { b: [1] };\n{code}\n\n{noformat}\n{{ x }}\n{noformat}",
		);
	});

	it("converts nested, numbered and task lists", () => {
		expect(
			markdownToWiki(
				[
					"- one",
					"  - nested",
					"1. first",
					"2. second",
					"- [ ] todo",
					"- [x] done",
				].join("\n"),
			),
		).toBe(
			[
				"* one",
				"** nested",
				"# first",
				"# second",
				"* ☐ todo",
				"* ☑ done",
			].join("\n"),
		);
	});

	it("converts tables, quotes and rules", () => {
		expect(
			markdownToWiki(
				[
					"| Test | Result |",
					"| --- | --- |",
					"| unit | ok |",
					"",
					"> note",
					"",
					"---",
				].join("\n"),
			),
		).toBe(
			["||Test||Result||", "|unit|ok|", "", "bq. note", "", "----"].join("\n"),
		);
	});

	it("escapes braces and brackets that would become macros or links", () => {
		expect(markdownToWiki("Status [WIP]: config {debug: true}")).toBe(
			"Status \\[WIP\\]: config \\{debug: true\\}",
		);
	});
});

describe("wikiToMarkdown", () => {
	it("converts headings, lists, emphasis and monospace", () => {
		expect(
			wikiToMarkdown("h2. Steps\n* open the *shop*\n** tap {{menu}}\n# first"),
		).toBe("## Steps\n- open the **shop**\n  - tap `menu`\n1. first");
	});

	it("converts code blocks, links and mentions", () => {
		expect(
			wikiToMarkdown(
				"{code:php}\n$a = 1;\n{code}\nSee [the docs|https://x.y/docs] and [https://a.b], [~accountid:42]",
				(id) => (id === "42" ? "Simon" : undefined),
			),
		).toBe(
			"```php\n$a = 1;\n```\nSee [the docs](https://x.y/docs) and https://a.b, @Simon",
		);
	});

	it("reads pasted smart links", () => {
		expect(
			wikiToMarkdown("[https://github.com/x|https://github.com/x|smart-link]"),
		).toBe("[https://github.com/x](https://github.com/x)");
	});
});

describe("mentions and signatures", () => {
	it("finds the agent's mention and strips it from the prompt", () => {
		const body = "[~accountid:agent-1] please also fix the *footer*";
		expect(mentionsAgent(body, "agent-1")).toBe(true);
		expect(mentionsAgent("@Nyrus can you look?", "agent-1")).toBe(true);
		expect(mentionsAgent("[~accountid:someone] hi", "agent-1")).toBe(false);
		expect(promptFromComment(body, "agent-1")).toBe(
			"please also fix the **footer**",
		);
	});

	it("recognises signed comments", () => {
		expect(isSigned(signed("Done."))).toBe(true);
		expect(isSigned("Done.")).toBe(false);
	});
});
