import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
	JiraEventTransport,
	normalizeWebhook,
} from "../src/JiraEventTransport.js";
import type { JiraWebhookEvent } from "../src/types.js";

const SECRET = "jira_test_secret";

function setup(secret = SECRET) {
	const routes: Record<
		string,
		(req: unknown, reply: unknown) => Promise<void>
	> = {};
	const fastify = {
		post: vi.fn((path: string, handler: never) => {
			routes[`POST ${path}`] = handler;
		}),
	};
	const transport = new JiraEventTransport({
		fastifyServer: fastify as never,
		webhookSecret: secret,
	});
	transport.register();
	const events: JiraWebhookEvent[] = [];
	transport.on("event", (e) => events.push(e));
	return { routes, events };
}

function reply() {
	return {
		code: vi.fn().mockReturnThis(),
		send: vi.fn().mockReturnThis(),
	};
}

async function post(
	routes: ReturnType<typeof setup>["routes"],
	body: unknown,
	options: {
		headers?: Record<string, string>;
		query?: Record<string, string>;
	} = {},
) {
	const r = reply();
	await routes["POST /jira-webhook"]!(
		{
			body,
			rawBody: JSON.stringify(body),
			headers: options.headers ?? {},
			query: options.query ?? {},
		},
		r,
	);
	return r;
}

const issueUpdated = {
	webhookEvent: "jira:issue_updated",
	user: { accountId: "simon", displayName: "Simon" },
	issue: { id: "10001", key: "ZOO-12" },
	changelog: {
		items: [{ field: "labels", fromString: "", toString: "nyrus" }],
	},
};

describe("JiraEventTransport", () => {
	it("accepts a webhook signed like a Jira admin webhook", async () => {
		const { routes, events } = setup();
		const signature = `sha256=${createHmac("sha256", SECRET)
			.update(JSON.stringify(issueUpdated))
			.digest("hex")}`;
		const r = await post(routes, issueUpdated, {
			headers: { "x-hub-signature": signature },
		});
		expect(r.code).toHaveBeenCalledWith(200);
		expect(events).toEqual([
			{
				kind: "issue",
				webhookEvent: "jira:issue_updated",
				issueKey: "ZOO-12",
				changelog: issueUpdated.changelog.items,
				actor: issueUpdated.user,
			},
		]);
	});

	it("accepts the secret itself from Jira Automation", async () => {
		const { routes, events } = setup();
		await post(routes, { issueKey: "ZOO-12" }, { query: { secret: SECRET } });
		expect(events).toMatchObject([
			{ kind: "issue", webhookEvent: "automation" },
		]);
	});

	it("rejects a wrong signature or secret", async () => {
		const { routes, events } = setup();
		const r1 = await post(routes, issueUpdated, {
			headers: { "x-hub-signature": "sha256=00" },
		});
		const r2 = await post(routes, issueUpdated, {
			headers: { "x-cyrus-webhook-secret": "nope" },
		});
		expect(r1.code).toHaveBeenCalledWith(401);
		expect(r2.code).toHaveBeenCalledWith(401);
		expect(events).toEqual([]);
	});
});

describe("normalizeWebhook", () => {
	it("reads comment webhooks", () => {
		expect(
			normalizeWebhook({
				webhookEvent: "comment_created",
				issue: { id: "10001", key: "ZOO-12" },
				comment: {
					id: "c-1",
					body: "hi",
					author: { accountId: "simon", displayName: "Simon" },
				},
			}),
		).toEqual({
			kind: "comment",
			webhookEvent: "comment_created",
			issueKey: "ZOO-12",
			changelog: [],
			comment: {
				id: "c-1",
				body: "hi",
				authorAccountId: "simon",
				authorName: "Simon",
			},
			actor: undefined,
		});
	});

	it("ignores events Cyrus doesn't act on", () => {
		expect(
			normalizeWebhook({
				webhookEvent: "comment_updated",
				issue: { key: "ZOO-12" },
			}),
		).toBeUndefined();
		expect(
			normalizeWebhook({ webhookEvent: "jira:issue_updated" }),
		).toBeUndefined();
	});
});
