import { createHmac } from "node:crypto";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ClickUpEventTransport } from "../src/ClickUpEventTransport.js";
import { createClickUpIntegration } from "../src/integration.js";
import type { ClickUpWebhookPayload } from "../src/types.js";

const SECRET = "clickup_wh_test_secret";
const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as never;

/** A Fastify server that keeps the raw body, as nyrus's shared server does. */
function server() {
	const app = Fastify();
	app.addContentTypeParser(
		"application/json",
		{ parseAs: "string" },
		(req: FastifyRequest, body: string, done) => {
			(req as FastifyRequest & { rawBody: string }).rawBody = body;
			try {
				done(null, JSON.parse(body));
			} catch (error) {
				done(error as Error);
			}
		},
	);
	return app;
}

const dirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "clickup-transport-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function setup(recordDir?: string) {
	const app = server();
	const transport = new ClickUpEventTransport(
		{ fastifyServer: app, webhookSecret: SECRET, recordDir },
		silent,
	);
	transport.register();
	const received: ClickUpWebhookPayload[] = [];
	transport.on("webhook", (payload) => received.push(payload));
	return { app, received };
}

const payload = {
	event: "taskCommentPosted",
	task_id: "1amxjbadtjm",
	webhook_id: "wh-1",
	history_items: [
		{
			id: "h-1",
			field: "comment",
			user: { id: 93852118, username: "Nick Sohl" },
			comment: { text_content: "/nyrus hello" },
		},
	],
};

function deliver(
	app: ReturnType<typeof server>,
	body: string,
	signature: string | undefined,
) {
	return app.inject({
		method: "POST",
		url: "/clickup-webhook",
		headers: {
			"content-type": "application/json",
			...(signature !== undefined && { "x-signature": signature }),
		},
		payload: body,
	});
}

const sign = (body: string, secret = SECRET) =>
	createHmac("sha256", secret).update(body).digest("hex");

describe("ClickUpEventTransport", () => {
	it("accepts a signed delivery and emits it", async () => {
		const { app, received } = setup();
		const body = JSON.stringify(payload);
		const response = await deliver(app, body, sign(body));

		expect(response.statusCode).toBe(200);
		expect(received).toEqual([payload]);
	});

	it("checks the signature against the raw bytes, not re-serialized JSON", async () => {
		const { app, received } = setup();
		// Whitespace and key order a re-serialization would change.
		const body = `{ "task_id": "t-1",\n  "event": "taskTagUpdated" }`;
		const response = await deliver(app, body, sign(body).toUpperCase());

		expect(response.statusCode).toBe(200);
		expect(received[0]?.event).toBe("taskTagUpdated");
	});

	it("rejects a wrong, foreign or missing signature with 400, never 401", async () => {
		const { app, received } = setup();
		const body = JSON.stringify(payload);
		const wrong = await deliver(app, body, "deadbeef");
		const foreign = await deliver(app, body, sign(body, "other-secret"));
		const missing = await deliver(app, body, undefined);
		const tampered = await deliver(
			app,
			body.replace("hello", "rm -rf"),
			sign(body),
		);

		for (const response of [wrong, foreign, missing, tampered]) {
			expect(response.statusCode).toBe(400);
		}
		expect(received).toHaveLength(0);
	});

	it("records verified deliveries when a record directory is set", async () => {
		const dir = tempDir();
		const { app } = setup(dir);
		const body = JSON.stringify(payload);
		await deliver(app, body, sign(body));
		await deliver(app, body, "deadbeef");
		await new Promise((resolve) => setTimeout(resolve, 50));

		const files = readdirSync(dir);
		expect(files).toHaveLength(1);
		expect(files[0]).toMatch(/_taskCommentPosted_1amxjbadtjm\.json$/);
		const saved = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));
		expect(saved.body).toEqual(payload);
		expect(saved.headers).not.toHaveProperty("x-signature");
		// Real task data: only nyrus's user may read it.
		expect(statSync(dir).mode & 0o777).toBe(0o700);
		expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600);
	});
});

describe("createClickUpIntegration", () => {
	it("stays off without a webhook secret", () => {
		expect(
			createClickUpIntegration({ env: {}, cyrusHome: "/tmp", logger: silent }),
		).toBeNull();
	});

	it("serves /clickup-webhook and records to <cyrus-home>/clickup-webhooks", async () => {
		const cyrusHome = tempDir();
		const integration = createClickUpIntegration({
			env: {
				CLICKUP_WEBHOOK_SECRET: SECRET,
				CLICKUP_TEAM_ID: "14278081",
				CLICKUP_WEBHOOK_RECORD: "1",
			},
			cyrusHome,
			logger: silent,
		})!;
		expect(integration.workspaceKey).toBe("clickup-14278081");
		expect(integration.tracker).toBeUndefined();

		const app = server();
		integration.register({
			fastify: app,
			dispatch: async () => {},
			getSessionState: () => "unknown",
			logger: silent,
		});
		const body = JSON.stringify(payload);
		expect((await deliver(app, body, sign(body))).statusCode).toBe(200);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(readdirSync(join(cyrusHome, "clickup-webhooks"))).toHaveLength(1);
	});
});
