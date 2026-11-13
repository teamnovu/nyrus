import { vi } from "vitest";
import { ClickUpApiClient } from "../src/ClickUpApiClient.js";
import type { ClickUpList, ClickUpSpace, ClickUpTask } from "../src/types.js";

export const API = "http://clickup.localhost/api/v2";

/**
 * Fake ClickUp API: routes "METHOD path" (query string dropped) to a JSON
 * body, a Response, or a function of the request body; records requests.
 */
export function fakeClickUp(routes: Record<string, unknown>) {
	const calls: Array<{ method: string; path: string; body?: unknown }> = [];
	const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
		const method = init.method ?? "GET";
		const path = url.replace(API, "").split("?")[0]!;
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ method, path, body });
		const key = `${method} ${path}`;
		if (!(key in routes)) {
			return new Response("not found", { status: 404 });
		}
		let route = routes[key];
		if (typeof route === "function") route = route(body);
		if (route instanceof Response) {
			return route.clone();
		}
		return new Response(route === undefined ? "" : JSON.stringify(route));
	});
	const api = new ClickUpApiClient(
		{ apiToken: "pk_test", teamId: "14278081" },
		{ fetch: fetchImpl as never, apiRoot: API },
	);
	return { api, calls, fetchImpl };
}

/** The person whose token nyrus uses. */
export const AGENT = {
	id: 900,
	username: "Token Person",
	email: "token@novu.ch",
};
export const SIMON = { id: 42, username: "Simon", email: "simon@novu.ch" };

export const SPACE_ID = "1500750000001463";

export function clickUpTask(overrides: Partial<ClickUpTask> = {}): ClickUpTask {
	return {
		id: "1amxjbadtjm",
		custom_id: null,
		name: "Mobile menu broken",
		text_content: "Steps\nopen the shop",
		markdown_description: "## Steps\n\n- open the **shop**\n- tap `menu`",
		status: {
			id: "p1_todo",
			status: "to do",
			type: "open",
			orderindex: 0,
			color: "#87909e",
		},
		date_created: "1794572427415",
		date_updated: "1794572427415",
		creator: SIMON,
		assignees: [],
		watchers: [SIMON],
		tags: [],
		parent: null,
		priority: { id: "2", priority: "high" },
		team_id: "14278081",
		url: "https://app.clickup.com/t/1amxjbadtjm",
		list: { id: "1500750000002693", name: "Tests" },
		folder: { id: "1500750000002105", name: "hidden" },
		space: { id: SPACE_ID },
		attachments: [],
		...overrides,
	};
}

const statuses = [
	{ status: "to do", type: "open", orderindex: 0 },
	{ status: "in progress", type: "custom", orderindex: 1 },
	{ status: "in review", type: "custom", orderindex: 2 },
	{ status: "complete", type: "closed", orderindex: 3 },
];

export const SPACE: ClickUpSpace = {
	id: SPACE_ID,
	name: "nyrus Sandbox",
	statuses,
};

export const LIST: ClickUpList = {
	id: "1500750000002693",
	name: "Tests",
	statuses,
};
