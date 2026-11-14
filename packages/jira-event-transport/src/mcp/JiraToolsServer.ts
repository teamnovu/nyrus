import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	readUploadImages,
	saveAttachment,
	type TrackerMcpSession,
	uniqueFileName,
} from "cyrus-comment-sessions";
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

const keySchema = z.string().describe('The issue key, e.g. "SAY-12"');

/**
 * MCP tools for an agent working on a Jira issue: read it, comment, attach
 * the pull request and move it through the workflow. Every call is made as
 * the agent account, so comments and changes show as Cyrus's.
 *
 * The server runs outside the session's sandbox, so file tools only use the
 * session's folders: downloads go to `session.attachmentsDir`, uploads come
 * from `session.workspacePath`. Without them, those tools refuse.
 */
export function createJiraToolsServer(
	api: JiraApiClient,
	session: Partial<TrackerMcpSession> = {},
): McpServer {
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
				"Download the files attached to a Jira issue (screenshots, spreadsheets, documents...) so you can open them; look at images with your Read tool. They are saved in this session's attachments folder, outside the repository, so they never end up in a commit. Returns each file's path; `name` is the file name in Jira, as images in the description refer to it.",
			inputSchema: { key: keySchema },
		},
		async ({ key }) => {
			try {
				if (!session.attachmentsDir) {
					return fail(
						"Attachments can't be downloaded in this session (it has no attachments folder).",
					);
				}
				const issue = await api.getIssue(key);
				const dir = join(session.attachmentsDir, issue.key);
				const files = [];
				for (const a of issue.fields.attachment ?? []) {
					const data = await api.download(a.content);
					files.push({
						name: a.filename,
						path: await saveAttachment(dir, a.filename || a.id, data),
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
		"upload_attachments",
		{
			description:
				"Attach images from your working directory to a Jira issue, e.g. before/after screenshots of your change. Then show them in a comment with add_comment, as Markdown images by the returned file name: ![Before](SAY-12-before.png). PNG, JPEG, GIF or WebP, at most 10 MB each. A name the issue already has gets a number (shot-2.png).",
			inputSchema: {
				key: keySchema,
				files: z
					.array(z.string())
					.min(1)
					.max(10)
					.describe(
						"Absolute paths of the images, inside your working directory",
					),
			},
		},
		async ({ key, files }) => {
			try {
				if (!session.workspacePath) {
					return fail(
						"Files can't be attached in this session (it has no working directory).",
					);
				}
				const images = await readUploadImages(files, [session.workspacePath]);
				const issue = await api.getIssue(key);
				const taken = new Set(
					(issue.fields.attachment ?? []).map((a) => a.filename),
				);
				const uploads = images.map((image) => ({
					...image,
					name: uniqueFileName(image.name, taken),
				}));
				const attachments = await api.addAttachments(issue.key, uploads);
				return ok({
					key: issue.key,
					attachments: attachments.map((a) => ({
						filename: a.filename,
						size: a.size ?? null,
					})),
				});
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
 * entry point, run with the current Node, authenticated as the agent account,
 * with the session's folders for downloads and uploads.
 */
export function jiraToolsMcpServerConfig(
	credentials: JiraCredentials,
	session?: TrackerMcpSession,
): {
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
			...(session && { JIRA_WORKSPACE_DIR: session.workspacePath }),
			...(session?.attachmentsDir && {
				JIRA_ATTACHMENTS_DIR: session.attachmentsDir,
			}),
		},
	};
}
