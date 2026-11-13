import { createHmac, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, type ILogger } from "cyrus-core";
import type { FastifyReply, FastifyRequest } from "fastify";
import type {
	ClickUpEventTransportConfig,
	ClickUpEventTransportEvents,
	ClickUpWebhookPayload,
} from "./types.js";

export declare interface ClickUpEventTransport {
	on<K extends keyof ClickUpEventTransportEvents>(
		event: K,
		listener: ClickUpEventTransportEvents[K],
	): this;
	emit<K extends keyof ClickUpEventTransportEvents>(
		event: K,
		...args: Parameters<ClickUpEventTransportEvents[K]>
	): boolean;
}

/**
 * ClickUpEventTransport - receives ClickUp webhooks on `POST /clickup-webhook`.
 *
 * ClickUp signs each delivery: `X-Signature` is the hex HMAC-SHA256 of the raw
 * body, keyed with the webhook's secret. A delivery that fails the check is
 * answered with 400, never 401: ClickUp suspends a webhook that gets a 401.
 * Verified deliveries are answered at once (ClickUp retries slow or failed
 * ones) and emitted as `webhook` events, and saved to `recordDir` if set.
 *
 * @see https://developer.clickup.com/docs/webhooksignature
 */
export class ClickUpEventTransport extends EventEmitter {
	private readonly logger: ILogger;
	private recorded = 0;

	constructor(
		private readonly config: ClickUpEventTransportConfig,
		logger?: ILogger,
	) {
		super();
		this.logger =
			logger ?? createLogger({ component: "ClickUpEventTransport" });
	}

	register(): void {
		this.config.fastifyServer.post(
			"/clickup-webhook",
			async (request: FastifyRequest, reply: FastifyReply) => {
				try {
					this.handleWebhook(request, reply);
				} catch (error) {
					const err = new Error("ClickUp webhook error", { cause: error });
					this.logger.error("ClickUp webhook error", err);
					this.emit("error", err);
					if (!reply.sent) {
						reply.code(500).send({ error: "Internal server error" });
					}
				}
			},
		);
		this.logger.info(
			`Registered POST /clickup-webhook${this.config.recordDir ? ` (recording to ${this.config.recordDir})` : ""}`,
		);
	}

	private handleWebhook(request: FastifyRequest, reply: FastifyReply): void {
		const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;
		const signature = request.headers["x-signature"];
		if (
			rawBody === undefined ||
			!this.verifySignature(
				rawBody,
				typeof signature === "string" ? signature : undefined,
			)
		) {
			this.logger.warn(
				`Rejected a ClickUp delivery: ${signature ? "invalid" : "missing"} signature`,
			);
			reply.code(400).send({ error: "Invalid webhook signature" });
			return;
		}
		reply.code(200).send({ ok: true });

		const payload = request.body as ClickUpWebhookPayload | undefined;
		if (typeof payload?.event !== "string") {
			this.logger.debug("Ignoring a ClickUp delivery without an event name");
			return;
		}
		this.logger.info(`Received ClickUp ${summarize(payload)}`);
		if (this.config.recordDir) {
			void this.record(payload, request);
		}
		this.emit("webhook", payload);
	}

	/** Constant-time check of `X-Signature`. */
	private verifySignature(rawBody: string, signature?: string): boolean {
		if (!signature) return false;
		const expected = Buffer.from(
			createHmac("sha256", this.config.webhookSecret)
				.update(rawBody)
				.digest("hex"),
		);
		const actual = Buffer.from(signature.trim().toLowerCase());
		return (
			expected.length === actual.length && timingSafeEqual(expected, actual)
		);
	}

	private async record(
		payload: ClickUpWebhookPayload,
		request: FastifyRequest,
	): Promise<void> {
		const dir = this.config.recordDir!;
		const name = [
			new Date().toISOString().replace(/[:.]/g, "-"),
			String(++this.recorded).padStart(4, "0"),
			payload.event,
			payload.task_id ?? "no-task",
		].join("_");
		try {
			// Real task data: readable only by nyrus's user.
			await mkdir(dir, { recursive: true, mode: 0o700 });
			await chmod(dir, 0o700);
			await writeFile(
				join(dir, `${safeName(name)}.json`),
				`${JSON.stringify(
					{
						receivedAt: new Date().toISOString(),
						headers: {
							"content-type": request.headers["content-type"],
							"user-agent": request.headers["user-agent"],
						},
						body: payload,
					},
					null,
					2,
				)}\n`,
				{ mode: 0o600 },
			);
		} catch (error) {
			this.logger.warn("Could not record a ClickUp delivery", error);
		}
	}
}

/**
 * "taskCommentPosted task abc (webhook w1): comment#h1 by 123", without
 * comment texts or names, which stay out of the logs.
 */
function summarize(payload: ClickUpWebhookPayload): string {
	const items = (payload.history_items ?? [])
		.map((item) => `${item.field ?? "?"}#${item.id} by ${item.user?.id ?? "?"}`)
		.join(", ");
	return `${payload.event} task ${payload.task_id ?? "?"} (webhook ${payload.webhook_id ?? "?"})${items ? `: ${items}` : ""}`;
}

function safeName(name: string): string {
	return name.replace(/[^A-Za-z0-9_-]/g, "-");
}
