import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { saveAttachment, type TrackerMcpSession } from "cyrus-comment-sessions";
import { z } from "zod";
import type { ClickUpApiClient } from "../ClickUpApiClient.js";
import {
	isSigned,
	markdownToRichText,
	mention,
	plainText,
	richTextToMarkdown,
	signed,
} from "../ClickUpText.js";
import type { ClickUpCredentials, ClickUpRichText } from "../types.js";

/** Comments returned by get_task, newest last. */
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

const taskSchema = z
	.string()
	.describe('The task id, e.g. "86c1abcde" (a "CU-" prefix is fine)');

const taskId = (id: string) => id.trim().replace(/^CU-/i, "");

const person = (user?: { id: number; username?: string | null } | null) =>
	user ? { id: user.id, name: user.username ?? null } : null;

/**
 * MCP tools for an agent working on a ClickUp task: read it, comment, move
 * it to another status and fetch its files. Every call is made with the
 * token of the person nyrus acts as; comments are signed "🤖 nyrus:".
 *
 * The server runs outside the session's sandbox, so downloads only go to the
 * session's attachments folder (`session.attachmentsDir`).
 */
export function createClickUpToolsServer(
	api: ClickUpApiClient,
	session: Partial<TrackerMcpSession> = {},
): McpServer {
	const server = new McpServer({ name: "clickup", version: "1.0.0" });

	server.registerTool(
		"get_task",
		{
			description:
				"Read a ClickUp task: name, status, priority, tags, assignees, List and Space, description, attached files and recent comments (nyrus's own left out). Use download_attachments to read the files.",
			inputSchema: { task: taskSchema },
		},
		async ({ task: id }) => {
			try {
				const [task, comments] = await Promise.all([
					api.getTask(taskId(id)),
					api.listComments(taskId(id)),
				]);
				return ok({
					id: task.id,
					url: task.url || api.taskUrl(task.id),
					name: task.name,
					status: task.status
						? { name: task.status.status, type: task.status.type ?? null }
						: null,
					priority: task.priority?.priority ?? null,
					tags: (task.tags ?? []).map((t) => t.name),
					assignees: (task.assignees ?? []).map(person),
					creator: person(task.creator),
					list: task.list ?? null,
					space: task.space?.id ?? null,
					parent: task.parent ?? null,
					description: task.markdown_description ?? task.text_content ?? "",
					attachments: (task.attachments ?? []).map((a) => ({
						name: a.title ?? a.id,
						type: a.mimetype ?? a.extension ?? null,
					})),
					comments: comments
						.filter(
							(c) => !isSigned(c.comment_text ?? plainText(c.comment ?? [])),
						)
						.slice(-MAX_COMMENTS)
						.map((c) => ({
							id: c.id,
							author: c.user?.username ?? c.user?.id ?? null,
							createdAt: c.date ? new Date(Number(c.date)).toISOString() : null,
							text: c.comment?.length
								? richTextToMarkdown(c.comment)
								: (c.comment_text ?? ""),
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
				"Post a comment on a ClickUp task, signed as nyrus. The body is Markdown. To notify people, pass their user ids in mention (see the assignees and creator in get_task); the mentions go at the start of the comment.",
			inputSchema: {
				task: taskSchema,
				body: z.string().min(1).describe("The comment, in Markdown"),
				mention: z
					.array(z.number().int())
					.optional()
					.describe("User ids to mention (notified by ClickUp)"),
			},
		},
		async ({ task, body, mention: mentions }) => {
			try {
				const mentionLine: ClickUpRichText[] = (mentions ?? []).length
					? [
							...(mentions ?? []).flatMap((id) => [mention(id), { text: " " }]),
							{ text: "\n" },
						]
					: [];
				const comment = await api.createComment(
					taskId(task),
					signed([...mentionLine, ...markdownToRichText(body)]),
				);
				return ok({ id: comment.id, url: api.taskUrl(taskId(task)) });
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"list_statuses",
		{
			description:
				"List the statuses a ClickUp task can have (those of its List), in order, with the current one.",
			inputSchema: { task: taskSchema },
		},
		async ({ task: id }) => {
			try {
				const task = await api.getTask(taskId(id));
				const list = task.list ? await api.getList(task.list.id) : undefined;
				return ok({
					task: task.id,
					current: task.status?.status ?? null,
					statuses: (list?.statuses ?? []).map((s) => ({
						name: s.status,
						type: s.type ?? null,
					})),
				});
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"set_status",
		{
			description:
				'Move a ClickUp task to another status of its List, by name (e.g. "in review", "complete"). Matching ignores case.',
			inputSchema: {
				task: taskSchema,
				status: z.string().min(1).describe("The status's name"),
			},
		},
		async ({ task: id, status }) => {
			try {
				const task = await api.getTask(taskId(id));
				const list = task.list ? await api.getList(task.list.id) : undefined;
				const statuses = list?.statuses ?? [];
				const wanted = status.trim().toLowerCase();
				const match = statuses.find((s) => s.status.toLowerCase() === wanted);
				if (!match) {
					return fail(
						`Task ${task.id} has no status "${status}". Possible: ${statuses.map((s) => s.status).join(", ")}`,
					);
				}
				await api.updateTask(task.id, { status: match.status });
				return ok({ task: task.id, status: match.status });
			} catch (error) {
				return fail(error);
			}
		},
	);

	server.registerTool(
		"download_attachments",
		{
			description:
				"Download the files attached to a ClickUp task (screenshots, spreadsheets, documents...) so you can open them; look at images with your Read tool. They are saved in this session's attachments folder, outside the repository, so they never end up in a commit. Returns each file's path.",
			inputSchema: { task: taskSchema },
		},
		async ({ task: id }) => {
			try {
				if (!session.attachmentsDir) {
					return fail(
						"Attachments can't be downloaded in this session (it has no attachments folder).",
					);
				}
				const task = await api.getTask(taskId(id));
				const dir = join(session.attachmentsDir, task.id);
				const files = [];
				for (const a of task.attachments ?? []) {
					const name = a.title || a.id;
					const data = await api.download(a.url);
					files.push({
						name,
						path: await saveAttachment(dir, name, data),
						size: data.length,
					});
				}
				return ok({ task: task.id, files });
			} catch (error) {
				return fail(error);
			}
		},
	);

	return server;
}

/**
 * How Claude Code starts the ClickUp tools for a session: this package's
 * stdio entry point, run with the current Node, with nyrus's token and the
 * session's attachments folder.
 */
export function clickUpToolsMcpServerConfig(
	credentials: ClickUpCredentials,
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
			CLICKUP_API_TOKEN: credentials.apiToken,
			...(credentials.teamId && { CLICKUP_TEAM_ID: credentials.teamId }),
			...(session?.attachmentsDir && {
				CLICKUP_ATTACHMENTS_DIR: session.attachmentsDir,
			}),
		},
	};
}
