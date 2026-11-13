import { vi } from "vitest";
import { JiraApiClient } from "../src/JiraApiClient.js";
import type { JiraIssue } from "../src/types.js";

export const BASE = "http://jira.localhost";
export const API = `${BASE}/rest/api/2`;

/**
 * Fake Jira server: routes "METHOD path" (query string dropped) to a JSON
 * body or a Response; records requests.
 */
export function fakeJira(routes: Record<string, unknown>) {
	const calls: Array<{ method: string; url: string; body?: unknown }> = [];
	const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
		const method = init.method ?? "GET";
		calls.push({
			method,
			url,
			body: init.body ? JSON.parse(String(init.body)) : undefined,
		});
		const path = url.replace(API, "").split("?")[0];
		const key = `${method} ${path}`;
		if (!(key in routes)) {
			return new Response("not found", { status: 404 });
		}
		const route = routes[key];
		if (route instanceof Response) {
			return route.clone();
		}
		return new Response(route === undefined ? "" : JSON.stringify(route));
	});
	const api = new JiraApiClient(
		{ baseUrl: BASE, email: "nyrus@novu.ch", apiToken: "token" },
		{ fetch: fetchImpl as never },
	);
	return { api, calls, fetchImpl };
}

export const AGENT = { accountId: "agent-1", displayName: "Nyrus" };

export function jiraIssue(
	overrides: Partial<JiraIssue["fields"]> = {},
): JiraIssue {
	return {
		id: "10001",
		key: "ZOO-12",
		fields: {
			summary: "Mobile menu broken",
			description: "h2. Steps\n* open the *shop*\n* tap {{menu}}",
			status: {
				id: "1",
				name: "To Do",
				statusCategory: { key: "new" },
			},
			assignee: null,
			labels: [],
			priority: { name: "High" },
			project: { id: "100", key: "ZOO", name: "Zoo Test" },
			created: "2026-11-13T10:00:00.000+0100",
			updated: "2026-11-13T10:00:00.000+0100",
			...overrides,
		},
	};
}
