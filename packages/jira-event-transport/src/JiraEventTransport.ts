import { createHmac, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { createLogger, type ILogger } from "cyrus-core";
import type { FastifyReply, FastifyRequest } from "fastify";
import type {
	JiraEventTransportConfig,
	JiraEventTransportEvents,
	JiraWebhookEvent,
	JiraWebhookPayload,
} from "./types.js";

export declare interface JiraEventTransport {
	on<K extends keyof JiraEventTransportEvents>(
		event: K,
		listener: JiraEventTransportEvents[K],
	): this;
	emit<K extends keyof JiraEventTransportEvents>(
		event: K,
		...args: Parameters<JiraEventTransportEvents[K]>
	): boolean;
}

/** Issue events that can hand an issue to Cyrus or take it away. */
const ISSUE_EVENTS = new Set(["jira:issue_created", "jira:issue_updated"]);

/**
 * JiraEventTransport - receives Jira webhooks at `POST /jira-webhook`.
 *
 * Accepts what a Jira admin webhook sends ("jira:issue_created",
 * "jira:issue_updated", "comment_created"; everything else is ignored) and
 * what a Jira Automation "Send web request" sends: the same shape, the issue
 * ("Issue data"), or a custom body with just `issueKey`. Requests without a
 * `webhookEvent` count as "automation" issue events.
 *
 * The request is answered at once and the work is done after the `event`
 * is emitted, so Jira doesn't retry slow deliveries.
 *
 * @see https://developer.atlassian.com/cloud/jira/platform/webhooks/
 */
export class JiraEventTransport extends EventEmitter {
	private readonly logger: ILogger;

	constructor(
		private readonly config: JiraEventTransportConfig,
		logger?: ILogger,
	) {
		super();
		this.logger = logger ?? createLogger({ component: "JiraEventTransport" });
	}

	register(): void {
		this.config.fastifyServer.post(
			"/jira-webhook",
			async (request: FastifyRequest, reply: FastifyReply) => {
				try {
					this.handleWebhook(request, reply);
				} catch (error) {
					const err = new Error("Jira webhook error", { cause: error });
					this.logger.error("Jira webhook error", err);
					this.emit("error", err);
					reply.code(500).send({ error: "Internal server error" });
				}
			},
		);
		this.logger.info("Registered POST /jira-webhook");
	}

	private handleWebhook(request: FastifyRequest, reply: FastifyReply): void {
		if (!this.isAuthorized(request)) {
			reply.code(401).send({ error: "Invalid webhook signature" });
			return;
		}
		reply.code(200).send({ ok: true });

		const event = normalizeWebhook(request.body as JiraWebhookPayload);
		if (!event) {
			const { webhookEvent } = (request.body ?? {}) as JiraWebhookPayload;
			this.logger.debug(
				`Ignoring Jira webhook ${webhookEvent ?? "(no event)"}`,
			);
			return;
		}
		this.logger.info(
			`Received Jira ${event.webhookEvent} for ${event.issueKey}`,
		);
		this.emit("event", event);
	}

	/**
	 * A Jira admin webhook with a secret signs the raw body (`X-Hub-Signature:
	 * sha256=<hex>`). Jira Automation can't sign, so it may send the secret
	 * itself, in an `X-Cyrus-Webhook-Secret` header or a `secret` query
	 * parameter. Without a configured secret nothing is accepted: a webhook
	 * can make the agent run commands, so it must never be open.
	 */
	private isAuthorized(request: FastifyRequest): boolean {
		const secret = this.config.webhookSecret;
		if (!secret) {
			return false;
		}
		const signature = header(request, "x-hub-signature");
		if (signature) {
			const rawBody =
				(request as FastifyRequest & { rawBody?: string }).rawBody ??
				JSON.stringify(request.body ?? {});
			const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
			return safeEqual(expected, signature.trim().toLowerCase());
		}
		const token =
			header(request, "x-cyrus-webhook-secret") ??
			(request.query as Record<string, string> | undefined)?.secret;
		return token !== undefined && safeEqual(secret, token);
	}
}

function header(request: FastifyRequest, name: string): string | undefined {
	const value = request.headers[name];
	return typeof value === "string" ? value : undefined;
}

function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/** A webhook body as a JiraWebhookEvent, or undefined if Cyrus doesn't act on it. Exported for tests. */
export function normalizeWebhook(
	body: JiraWebhookPayload | undefined,
): JiraWebhookEvent | undefined {
	if (!body || typeof body !== "object") {
		return undefined;
	}
	const issueKey =
		body.issue?.key ?? body.issueKey ?? body.key ?? body.issue?.id;
	if (!issueKey) {
		return undefined;
	}
	const webhookEvent = body.webhookEvent ?? "automation";
	const actor = body.user?.accountId ? body.user : undefined;

	if (webhookEvent === "comment_created") {
		const comment = body.comment;
		if (!comment?.id) {
			return undefined;
		}
		return {
			kind: "comment",
			webhookEvent,
			issueKey,
			changelog: [],
			comment: {
				id: String(comment.id),
				body: comment.body ?? "",
				authorAccountId: comment.author?.accountId,
				authorName: comment.author?.displayName,
			},
			actor,
		};
	}

	if (webhookEvent !== "automation" && !ISSUE_EVENTS.has(webhookEvent)) {
		return undefined;
	}
	return {
		kind: "issue",
		webhookEvent,
		issueKey,
		changelog: body.changelog?.items ?? [],
		actor,
	};
}
