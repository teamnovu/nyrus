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

	it("keeps backticks inside inline code delimited by longer runs", () => {
		expect(markdownToWiki("Use ``foo`bar`` or `` `x` `` here")).toBe(
			"Use {{foo`bar}} or {{`x`}} here",
		);
	});

	it("keeps hashes that belong to a heading's text", () => {
		expect(markdownToWiki("# C#\n## Title ##")).toBe("h1. C#\nh2. Title");
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

	it("takes a separator row without outer pipes", () => {
		expect(markdownToWiki("| A | B |\n--- | ---\n| x | y |")).toBe(
			"||A||B||\n|x|y|",
		);
	});

	it("keeps table data rows that start with dashes", () => {
		expect(
			markdownToWiki(
				"| Step | State |\n| --- | --- |\n| build | done |\n| --- | pending |",
			),
		).toBe("||Step||State||\n|build|done|\n|---|pending|");
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

	it("reads monospace with escaped braces back as inline code", () => {
		// "C:\\\\" ends in a backslash right before the closing braces.
		for (const code of ["a}", "{b}", "x{y}z", "plain", "C:\\\\", "a\\b"]) {
			expect(wikiToMarkdown(markdownToWiki(`\`${code}\``))).toBe(`\`${code}\``);
		}
	});

	it("keeps monospace spans apart when the first ends in a backslash", () => {
		expect(wikiToMarkdown("{{C:\\}} and {{b}}")).toBe("`C:\\` and `b`");
		expect(wikiToMarkdown("{{a\\}}} and {{b}}")).toBe("`a}` and `b`");
		expect(wikiToMarkdown("{{}} then {{b}}")).toBe("{{}} then `b`");
		expect(wikiToMarkdown("{{open and {{b}}")).toBe("`open and {{b`");
	});

	it("reads unclosed monospace spans in linear time", () => {
		const started = Date.now();
		expect(wikiToMarkdown(`{{${"\\}".repeat(5000)} never closed`)).toContain(
			"never closed",
		);
		expect(wikiToMarkdown("{{a".repeat(10000))).toContain("{{a{{a");
		expect(Date.now() - started).toBeLessThan(200);
	});

	it("reads pasted smart links", () => {
		expect(
			wikiToMarkdown("[https://github.com/x|https://github.com/x|smart-link]"),
		).toBe("[https://github.com/x](https://github.com/x)");
	});

	it("keeps blank lines inside code blocks", () => {
		expect(
			wikiToMarkdown(
				'Before\n\n\n\n{code:python}\ns = """a\n\n\n\nb"""\n{code}',
			),
		).toBe('Before\n\n```python\ns = """a\n\n\n\nb"""\n```');
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
		expect(isSigned(signed("Done.").replace(/\n/g, "\r\n"))).toBe(true);
		expect(isSigned("Done.")).toBe(false);
	});

	it("doesn't take a user's quote of a signed comment for Nyrus's own", () => {
		expect(isSigned(`As you wrote:\n{quote}${signed("Done.")}{quote}`)).toBe(
			false,
		);
	});
});
