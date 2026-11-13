import { createLogger, type ILogger } from "cyrus-core";
import { plainText } from "./ClickUpText.js";
import type {
	ClickUpComment,
	ClickUpCredentials,
	ClickUpList,
	ClickUpRichText,
	ClickUpSpace,
	ClickUpTag,
	ClickUpTask,
	ClickUpUser,
} from "./types.js";

export const CLICKUP_API = "https://api.clickup.com/api/v2";

/** Stop paging comments after this many pages (25 each). */
const MAX_COMMENT_PAGES = 20;

export class ClickUpApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: string,
	) {
		super(message);
		this.name = "ClickUpApiError";
	}
}

type FetchLike = typeof fetch;

/**
 * Minimal client for ClickUp's REST API v2, authenticated with a person's
 * personal token (`Authorization: pk_…`, no "Bearer").
 */
export class ClickUpApiClient {
	private readonly logger: ILogger;
	private readonly fetchImpl: FetchLike;
	private readonly apiRoot: string;

	constructor(
		private readonly credentials: ClickUpCredentials,
		options: { logger?: ILogger; fetch?: FetchLike; apiRoot?: string } = {},
	) {
		this.logger =
			options.logger ?? createLogger({ component: "ClickUpApiClient" });
		this.fetchImpl = options.fetch ?? fetch;
		this.apiRoot = options.apiRoot ?? CLICKUP_API;
	}

	get teamId(): string | undefined {
		return this.credentials.teamId;
	}

	/** A copy of the credentials in use, e.g. to start the ClickUp tools as the same person. */
	getCredentials(): ClickUpCredentials {
		return { ...this.credentials };
	}

	taskUrl(taskId: string): string {
		return `https://app.clickup.com/t/${taskId}`;
	}

	// ----- users -----

	async me(): Promise<ClickUpUser> {
		return (await this.request<{ user: ClickUpUser }>("GET", "/user")).user;
	}

	// ----- tasks -----

	getTask(taskId: string): Promise<ClickUpTask> {
		return this.request("GET", `/task/${encodeURIComponent(taskId)}`, {
			query: { include_markdown_description: "true" },
		});
	}

	async updateTask(
		taskId: string,
		fields: Record<string, unknown>,
	): Promise<void> {
		await this.request("PUT", `/task/${encodeURIComponent(taskId)}`, {
			body: fields,
		});
	}

	async addTag(taskId: string, tag: string): Promise<void> {
		await this.request(
			"POST",
			`/task/${encodeURIComponent(taskId)}/tag/${encodeURIComponent(tag)}`,
		);
	}

	async removeTag(taskId: string, tag: string): Promise<void> {
		await this.request(
			"DELETE",
			`/task/${encodeURIComponent(taskId)}/tag/${encodeURIComponent(tag)}`,
		);
	}

	// ----- comments -----

	/**
	 * A task's comments, oldest first. ClickUp answers 25 at a time, newest
	 * first; older ones are asked for with the oldest one's date and id.
	 * Threaded replies are not included (see {@link listReplies}).
	 */
	async listComments(taskId: string): Promise<ClickUpComment[]> {
		const comments: ClickUpComment[] = [];
		let query: Record<string, string> = {};
		for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
			const data = await this.request<{ comments?: ClickUpComment[] }>(
				"GET",
				`/task/${encodeURIComponent(taskId)}/comment`,
				{ query },
			);
			const batch = (data?.comments ?? []).map(normalizeComment);
			const fresh = batch.filter((c) => !comments.some((k) => k.id === c.id));
			comments.push(...fresh);
			const oldest = batch.at(-1);
			if (fresh.length === 0 || batch.length < 25 || !oldest?.date) break;
			query = { start: oldest.date, start_id: oldest.id };
		}
		return comments.reverse();
	}

	async listReplies(commentId: string): Promise<ClickUpComment[]> {
		const data = await this.request<{ comments?: ClickUpComment[] }>(
			"GET",
			`/comment/${encodeURIComponent(commentId)}/reply`,
		);
		return (data?.comments ?? []).map(normalizeComment);
	}

	/** Post a rich text comment; ClickUp answers with the new id (a number). */
	async createComment(
		taskId: string,
		comment: ClickUpRichText[],
	): Promise<{ id: string }> {
		const data = await this.request<{ id: string | number }>(
			"POST",
			`/task/${encodeURIComponent(taskId)}/comment`,
			{ body: { comment, notify_all: false } },
		);
		return { id: String(data.id) };
	}

	/**
	 * Replace a comment's text. ClickUp documents `comment_text` for edits, so
	 * the plain text goes along with the rich text.
	 */
	async updateComment(
		commentId: string,
		comment: ClickUpRichText[],
	): Promise<void> {
		await this.request("PUT", `/comment/${encodeURIComponent(commentId)}`, {
			body: { comment, comment_text: plainText(comment) },
		});
	}

	async deleteComment(commentId: string): Promise<void> {
		await this.request("DELETE", `/comment/${encodeURIComponent(commentId)}`);
	}

	// ----- spaces and lists -----

	getSpace(spaceId: string): Promise<ClickUpSpace> {
		return this.request("GET", `/space/${encodeURIComponent(spaceId)}`);
	}

	getList(listId: string): Promise<ClickUpList> {
		return this.request("GET", `/list/${encodeURIComponent(listId)}`);
	}

	async listSpaceTags(spaceId: string): Promise<ClickUpTag[]> {
		const data = await this.request<{ tags?: ClickUpTag[] }>(
			"GET",
			`/space/${encodeURIComponent(spaceId)}/tag`,
		);
		return data?.tags ?? [];
	}

	// ----- files -----

	/** Download an attachment's URL with the token (private attachments need it). */
	async download(url: string): Promise<Buffer> {
		const response = await this.fetchImpl(url, {
			headers: { Authorization: this.credentials.apiToken },
		});
		if (!response.ok) {
			throw new ClickUpApiError(
				`ClickUp download failed: ${response.status}`,
				response.status,
				(await response.text()).slice(0, 500),
			);
		}
		return Buffer.from(await response.arrayBuffer());
	}

	// ----- plumbing -----

	private async request<T>(
		method: string,
		path: string,
		{ body, query }: { body?: unknown; query?: Record<string, string> } = {},
	): Promise<T> {
		const url = new URL(`${this.apiRoot}${path}`);
		for (const [key, value] of Object.entries(query ?? {})) {
			url.searchParams.set(key, value);
		}
		const response = await this.fetchImpl(url.toString(), {
			method,
			headers: {
				Authorization: this.credentials.apiToken,
				Accept: "application/json",
				...(body !== undefined && { "Content-Type": "application/json" }),
			},
			...(body !== undefined && { body: JSON.stringify(body) }),
		});
		const text = await response.text();
		if (!response.ok) {
			this.logger.debug(`ClickUp ${method} ${path} failed: ${response.status}`);
			throw new ClickUpApiError(
				`ClickUp ${method} ${path} failed: ${response.status} ${text.slice(0, 200)}`,
				response.status,
				text.slice(0, 500),
			);
		}
		return (text ? JSON.parse(text) : undefined) as T;
	}
}

/** Comment ids come as numbers or strings; nyrus keeps them as strings. */
function normalizeComment(comment: ClickUpComment): ClickUpComment {
	return { ...comment, id: String(comment.id) };
}
