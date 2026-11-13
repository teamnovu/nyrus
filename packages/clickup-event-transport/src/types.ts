import type { FastifyInstance } from "fastify";

/**
 * ClickUp webhook deliveries, as far as ClickUp's docs describe them. Fields
 * are optional and loose on purpose: they are to be confirmed against
 * recorded deliveries (docs/nyrus/clickup-spike.md) before nyrus acts on them.
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
	/** What changed, e.g. "comment", "tag", "status", "assignee_add" */
	field?: string;
	date?: string;
	user?: { id: number; username?: string; email?: string };
	before?: unknown;
	after?: unknown;
	comment?: Record<string, unknown>;
	[key: string]: unknown;
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
