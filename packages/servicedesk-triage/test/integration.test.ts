import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ILogger } from "cyrus-core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
	createServicedeskTriageIntegrationFactory,
	TRIAGE_API_PATH,
	TRIAGE_WEBHOOK_PATH,
} from "../src/index.js";

const logger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as unknown as ILogger;

const env = {
	TRIAGE_JIRA_PROJECTS: "NOV",
	JIRA_BASE_URL: "https://site.atlassian.net",
	JIRA_EMAIL: "nyrus@novu.ch",
	JIRA_API_TOKEN: "jira-token",
	JIRA_WEBHOOK_SECRET: "s3cret",
	INBUDGET_URL: "https://api.inbudget.test",
	INBUDGET_TOKEN: "ib-token",
	CYRUS_API_KEY: "api-key",
	TRIAGE_CLAUDE: "false",
};

/** A Jira site and inBudget answering just enough for one ticket. */
function fakeFetch() {
	const comments: unknown[] = [];
	const impl = (async (input: string | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const json = (body: unknown) =>
			new Response(JSON.stringify(body), {
				headers: { "content-type": "application/ld+json" },
			});
		if (url.pathname === "/rest/api/2/issue/NOV-7") {
			return json({
				id: "7",
				key: "NOV-7",
				fields: {
					summary: "Webseite Ombudsstelle",
					project: { id: "1", key: "NOV", name: "novu Support" },
					reporter: { accountId: "qm", displayName: "peter@siba.ch" },
					assignee: null,
				},
			});
		}
		if (url.pathname === "/rest/api/2/issue/NOV-7/comment") {
			if (init?.method === "POST") {
				comments.push(JSON.parse(String(init.body)));
				return json({ id: "c1" });
			}
			return json({ comments: [], total: 0 });
		}
		if (url.pathname === "/api/projects") {
			return json({
				member: [
					{ id: 20, name: "Ombudsstelle", client: { id: 2, name: "SIBA" } },
				],
			});
		}
		if (url.pathname === "/api/client_resources") {
			return json({
				member: [{ client: { id: 2, name: "SIBA" }, primaryDomain: "siba.ch" }],
			});
		}
		if (url.pathname === "/api/projects/20/work_hour_insights") {
			return json({ users: [{ id: 1, name: "Anna", hours: 3 }] });
		}
		if (url.pathname === "/api/users") {
			return json({
				member: [{ id: 1, fullName: "Anna Muster", email: "anna@novu.ch" }],
			});
		}
		return json({ member: [] });
	}) as typeof fetch;
	return { impl, comments };
}

async function server(overrides: Record<string, string | undefined> = {}) {
	const { impl, comments } = fakeFetch();
	const integration = createServicedeskTriageIntegrationFactory({
		fetch: impl,
	})({
		env: { ...env, ...overrides },
		cyrusHome: mkdtempSync(join(tmpdir(), "triage-")),
		logger,
	});
	const fastify = Fastify();
	integration?.register({
		fastify,
		dispatch: async () => {},
		getSessionState: () => "unknown",
		logger,
	});
	return { fastify, comments, integration };
}

describe("service desk triage integration", () => {
	it("stays off without TRIAGE_JIRA_PROJECTS and reports missing settings", async () => {
		expect(
			(await server({ TRIAGE_JIRA_PROJECTS: undefined })).integration,
		).toBeNull();
		expect(
			(await server({ INBUDGET_TOKEN: undefined })).integration,
		).toBeNull();
		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining("INBUDGET_TOKEN"),
		);
	});

	it("rejects unsigned webhooks and triages signed ones as an internal comment", async () => {
		const { fastify, comments } = await server();
		const body = JSON.stringify({
			webhookEvent: "jira:issue_created",
			issue: { key: "NOV-7" },
		});
		const bad = await fastify.inject({
			method: "POST",
			url: TRIAGE_WEBHOOK_PATH,
			headers: {
				"content-type": "application/json",
				"x-hub-signature": "sha256=00",
			},
			payload: body,
		});
		expect(bad.statusCode).toBe(401);
		const good = await fastify.inject({
			method: "POST",
			url: `${TRIAGE_WEBHOOK_PATH}?secret=s3cret`,
			headers: { "content-type": "application/json" },
			payload: body,
		});
		expect(good.statusCode).toBe(200);
		await vi.waitFor(() => expect(comments).toHaveLength(1));
		expect(comments[0]).toEqual({
			body: expect.stringContaining(
				"*Vorschlag Bearbeitung:* Anna Muster (3 h)",
			),
			properties: [{ key: "sd.public.comment", value: { internal: true } }],
		});
	});

	it("triages by hand as a dry run by default, with CYRUS_API_KEY", async () => {
		const { fastify, comments } = await server();
		const denied = await fastify.inject({
			method: "POST",
			url: TRIAGE_API_PATH,
			payload: { issueKey: "NOV-7" },
		});
		expect(denied.statusCode).toBe(401);
		const response = await fastify.inject({
			method: "POST",
			url: TRIAGE_API_PATH,
			headers: { authorization: "Bearer api-key" },
			payload: { issueKey: "NOV-7" },
		});
		expect(response.statusCode).toBe(200);
		const outcome = response.json().data;
		expect(outcome.status).toBe("triaged");
		expect(outcome.result.project.name).toBe("Ombudsstelle");
		expect(comments).toHaveLength(0);
	});
});
