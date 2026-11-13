import type { FastifyInstance } from "fastify";

/**
 * ClickUp types.
 *
 * ClickUp has no agent API and novu allows no bot accounts, so nyrus works
 * through ClickUp's REST API v2 with one person's token and signs its
 * comments. These types cover the parts of the API and of webhook deliveries
 * nyrus reads; fields ClickUp doesn't always send are optional.
 *
 * @see https://developer.clickup.com/reference
 */

export interface ClickUpUser {
	id: number;
	username?: string | null;
	email?: string | null;
	initials?: string;
	color?: string;
}

/** A status. `type` is "open", "custom", "done" or "closed". */
export interface ClickUpStatus {
	id?: string;
	status: string;
	type?: string;
	orderindex?: number | string;
	color?: string;
}

export interface ClickUpTag {
	name: string;
	tag_fg?: string;
	tag_bg?: string;
}

export interface ClickUpAttachment {
	id: string;
	title?: string;
	url: string;
	extension?: string;
	size?: number | string;
	mimetype?: string;
}

/** As `GET /task/{id}?include_markdown_description=true` answers. */
export interface ClickUpTask {
	id: string;
	custom_id?: string | null;
	name: string;
	text_content?: string | null;
	description?: string | null;
	markdown_description?: string | null;
	status?: ClickUpStatus;
	date_created?: string;
	date_updated?: string;
	creator?: ClickUpUser;
	assignees?: ClickUpUser[];
	watchers?: ClickUpUser[];
	tags?: ClickUpTag[];
	parent?: string | null;
	/** `id` "1" urgent, "2" high, "3" normal, "4" low: Linear's numbers. */
	priority?: { id?: string; priority?: string } | null;
	team_id?: string;
	url?: string;
	list?: { id: string; name?: string };
	folder?: { id: string; name?: string };
	space?: { id: string; name?: string };
	attachments?: ClickUpAttachment[];
}

export interface ClickUpSpace {
	id: string;
	name: string;
	statuses?: ClickUpStatus[];
}

export interface ClickUpList {
	id: string;
	name: string;
	statuses?: ClickUpStatus[];
	space?: { id: string; name?: string };
}

/**
 * One piece of a rich text comment, Quill-style: text with inline
 * attributes (bold, italic, code, link), block formats (lists, code blocks)
 * on the "\n" that ends the line, or a mention (`type: "tag"`).
 */
export interface ClickUpRichText {
	text?: string;
	attributes?: Record<string, unknown>;
	type?: string;
	user?: { id: number; username?: string; email?: string };
	[key: string]: unknown;
}

export interface ClickUpComment {
	id: string;
	comment?: ClickUpRichText[];
	comment_text?: string;
	user?: ClickUpUser;
	/** Milliseconds since the epoch, as a string */
	date?: string;
	reply_count?: number | string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * A webhook delivery. Deliveries are thin (the task has to be fetched), and
 * their exact shapes are not confirmed yet (docs/nyrus/clickup-spike.md), so
 * nyrus reads as little from them as it can.
 *
 * @see https://developer.clickup.com/docs/webhooks
 */
export interface ClickUpWebhookPayload {
	/** e.g. "taskCommentPosted", "taskTagUpdated", "taskStatusUpdated" */
	event: string;
	webhook_id?: string;
	task_id?: string;
	history_items?: ClickUpHistoryItem[];
	[key: string]: unknown;
}

/** One change in a delivery. Its id is unique per change: the idempotency key. */
export interface ClickUpHistoryItem {
	id: string;
	/** What changed, e.g. "comment", "tag", "tag_removed", "status", "assignee_add" */
	field?: string;
	date?: string;
	user?: ClickUpUser;
	before?: unknown;
	after?: unknown;
	/** On "comment" items: the comment, with `id`, `comment` and `text_content`. */
	comment?: {
		id?: string | number;
		comment?: ClickUpRichText[];
		text_content?: string;
		user?: ClickUpUser;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ClickUpCredentials {
	/** Personal token (`pk_…`) of the person nyrus acts as */
	apiToken: string;
	/** The workspace ("team" in the API), e.g. 14278081 */
	teamId?: string;
}

export interface ClickUpTriggerOptions {
	/** Adding this tag to a task hands it to nyrus. Empty to disable. */
	triggerTag: string;
	/**
	 * Assigning a task to the token's person hands it to nyrus. Off by
	 * default: that person also gets real assignments.
	 */
	triggerOnAssign: boolean;
	/** Spaces nyrus works in; empty means every Space the webhook covers. */
	spaceIds: string[];
}

export interface ClickUpEventTransportConfig {
	fastifyServer: FastifyInstance;
	/** The webhook's secret, for `X-Signature` (hex HMAC-SHA256 of the raw body). */
	webhookSecret: string;
	/**
	 * Save every verified delivery as a JSON file in this directory, to learn
	 * the real payloads and build test fixtures. Off when undefined.
	 */
	recordDir?: string;
}

export interface ClickUpEventTransportEvents {
	webhook: (payload: ClickUpWebhookPayload) => void;
	error: (error: Error) => void;
}
