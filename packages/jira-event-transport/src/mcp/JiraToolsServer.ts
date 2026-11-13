import { mkdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JiraApiClient } from "../JiraApiClient.js";
import {
	isSigned,
	markdownToWiki,
	mentionMarkup,
	signed,
	wikiToMarkdown,
} from "../JiraText.js";
import type { JiraCredentials } from "../types.js";

/** Comments returned by get_issue, newest last. */
const MAX_COMMENTS = 30;

type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

function ok(data: unknown): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): ToolResult {
	const message = error instanceof Error ? error.message : String(error);
	return { content: [{ type: "text", text: message }], isError: true };
}

/** `name`, or `name (2).ext` etc. if a file of that name was already saved. */
function uniqueName(name: string, used: Set<string>): string {
	let candidate = name;
	for (let n = 2; used.has(candidate); n++) {
		const dot = name.lastIndexOf(".");
		candidate =
			dot > 0
				? `${name.slice(0, dot)} (${n})${name.slice(dot)}`
				: `${name} (${n})`;
	}
	used.add(candidate);
	return candidate;
}

const keySchema = z.string().describe('The issue key, e.g. "SAY-12"');

/**
 * MCP tools for an agent working on a Jira issue: read it, comment, attach
 * the pull request and move it through the workflow. Every call is made as
 * the agent account, so comments and changes show as Cyrus's.
 */
export function createJiraToolsServer(api: JiraApiClient): McpServer {
	const server = new McpServer({ name: "jira", version: "1.0.0" });

	server.registerTool(
		"get_issue",
		{
			description:
				"Read a Jira issue: summary, status, type, priority, labels, assignee, description, attached files and recent comments. Use download_attachments to read the files.",
			inputSchema: { key: keySchema },
		},
		async ({ key }) => {
			try {
				const [issue, comments] = await Promise.all([
					api.getIssue(key),
					api.listComments(key),
				]);
				const f = issue.fields;
				return ok({
					key: issue.key,
					url: api.issueUrl(issue.key),
					summary: f.summary,
					type: f.issuetype?.name ?? null,
					status: f.status
						? { name: f.status.name, category: f.status.statusCategory?.key }
						: null,
					priority: f.priority?.name ?? null,
					labels: f.labels ?? [],
					assignee: f.assignee
						? { accountId: f.assignee.accountId, name: f.assignee.displayName }
						: null,
					reporter: f.reporter
						? { accountId: f.reporter.accountId, name: f.reporter.displayName }
						: null,
					parent: f.parent?.key ?? null,
					description: wikiToMarkdown(f.description ?? ""),
					attachments: (f.attachment ?? []).map((a) => ({
						name: a.filename,
						type: a.mimeType ?? null,
						size: a.size ?? null,
					})),
					comments: comments
						.filter((c) => !isSigned(c.body))
						.slice(-MAX_COMMENTS)
						.map((c) => ({
							id: c.id,
							author: c.author?.displayName ?? c.author?.accountId ?? null,
							createdAt: c.created,
							text: wikiToMarkdown(c.body ?? ""),
						})),
				});
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"add_comment",
		{
			description:
				"Post a comment on a Jira issue, as the agent. The body is Markdown. To notify people, pass their account ids in mention (see the assignee and reporter in get_issue); the mentions go at the start of the comment.",
			inputSchema: {
				key: keySchema,
				body: z.string().min(1).describe("The comment, in Markdown"),
				mention: z
					.array(z.string())
					.optional()
					.describe("Account ids to mention (notified by Jira)"),
			},
		},
		async ({ key, body, mention }) => {
			try {
				const mentions = (mention ?? []).map(mentionMarkup).join(" ");
				const wiki = [mentions, markdownToWiki(body)]
					.filter(Boolean)
					.join("\n");
				const comment = await api.createComment(key, signed(wiki));
				return ok({ id: comment.id, url: api.issueUrl(key) });
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"download_attachments",
		{
			description:
				"Download the files attached to a Jira issue (screenshots, spreadsheets, documents...) into a directory, e.g. your working directory, so you can open them. Returns each file's path.",
			inputSchema: {
				key: keySchema,
				directory: z
					.string()
					.describe(
						"Absolute path of the directory to save into; created if missing",
					),
			},
		},
		async ({ key, directory }) => {
			try {
				if (!isAbsolute(directory)) {
					return fail("directory must be an absolute path");
				}
				const issue = await api.getIssue(key);
				await mkdir(directory, { recursive: true });
				const used = new Set<string>();
				const files = [];
				for (const a of issue.fields.attachment ?? []) {
					const original = basename(a.filename || a.id);
					const data = await api.download(a.content);
					let name = uniqueName(original, used);
					let path = join(directory, name);
					// Never overwrite: the directory may be the worktree itself.
					for (;;) {
						try {
							await writeFile(path, data, { flag: "wx" });
							break;
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
								throw error;
							}
							name = uniqueName(original, used);
							path = join(directory, name);
						}
					}
					files.push({
						name,
						path,
						size: data.length,
						type: a.mimeType ?? null,
					});
				}
				return ok({ key: issue.key, files });
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"add_link",
		{
			description:
				'Attach a link to a Jira issue, e.g. the pull request you opened ("PR #20: Fix login"). Calling it again with the same URL updates the title, e.g. to add "(merged)".',
			inputSchema: {
				key: keySchema,
				url: z.string().url().describe("The link, e.g. the PR's URL"),
				title: z
					.string()
					.min(1)
					.describe('Shown in Jira, e.g. "PR #20: Fix login"'),
			},
		},
		async ({ key, url, title }) => {
			try {
				const link = await api.upsertRemoteLink(key, url, title);
				return ok({ key, id: link.id, url, title });
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"list_transitions",
		{
			description:
				"List the workflow transitions a Jira issue can take now, with the status each leads to.",
			inputSchema: { key: keySchema },
		},
		async ({ key }) => {
			try {
				const [issue, transitions] = await Promise.all([
					api.getIssue(key),
					api.listTransitions(key),
				]);
				return ok({
					key,
					current: issue.fields.status?.name ?? null,
					transitions: transitions.map((t) => ({
						name: t.name,
						to: t.to.name,
						category: t.to.statusCategory?.key ?? null,
					})),
				});
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"transition_issue",
		{
			description:
				'Move a Jira issue to another status, by the transition\'s or the target status\'s name (e.g. "In Review", "Done"). Matching ignores case.',
			inputSchema: {
				key: keySchema,
				to: z.string().min(1).describe("Transition or status name"),
			},
		},
		async ({ key, to }) => {
			try {
				const transitions = await api.listTransitions(key);
				const wanted = to.trim().toLowerCase();
				const transition =
					transitions.find((t) => t.to.name.toLowerCase() === wanted) ??
					transitions.find((t) => t.name.toLowerCase() === wanted);
				if (!transition) {
					return fail(
						`${key} cannot move to "${to}" now. Possible: ${transitions.map((t) => t.to.name).join(", ")}`,
					);
				}
				await api.transitionIssue(key, transition.id);
				return ok({ key, status: transition.to.name });
			} catch (error) {
				return fail(error);
			}
		},
	);

	return server;
}

/**
 * How Claude Code starts the Jira tools for a session: this package's stdio
 * entry point, run with the current Node, authenticated as the agent account.
 */
export function jiraToolsMcpServerConfig(credentials: JiraCredentials): {
	type: "stdio";
	command: string;
	args: string[];
	env: Record<string, string>;
} {
	return {
		type: "stdio",
		command: process.execPath,
		args: [fileURLToPath(new URL("./stdio.js", import.meta.url))],
		env: {
			JIRA_BASE_URL: credentials.baseUrl,
			JIRA_EMAIL: credentials.email,
			JIRA_API_TOKEN: credentials.apiToken,
		},
	};
}
