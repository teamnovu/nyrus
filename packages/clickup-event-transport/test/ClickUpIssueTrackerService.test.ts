import { describe, expect, it } from "vitest";
import {
	branchName,
	ClickUpIssueTrackerService,
} from "../src/ClickUpIssueTrackerService.js";
import { createClickUpIntegrationFactory } from "../src/integration.js";
import type { ClickUpTask } from "../src/types.js";
import {
	AGENT,
	clickUpTask,
	fakeClickUp,
	LIST,
	SPACE,
	SPACE_ID,
} from "./fakeClickUp.js";

const TASK = "1amxjbadtjm";

const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as never;

function setup(task: ClickUpTask = clickUpTask(), routes = {}) {
	const fake = fakeClickUp({
		"GET /user": { user: AGENT },
		[`GET /task/${TASK}`]: task,
		[`PUT /task/${TASK}`]: {},
		[`GET /space/${SPACE_ID}`]: SPACE,
		[`GET /list/${LIST.id}`]: LIST,
		...routes,
	});
	const tracker = new ClickUpIssueTrackerService(fake.api, "clickup-14278081", {
		triggerTag: "nyrus",
		triggerOnAssign: false,
		spaceIds: [SPACE_ID],
		progressMinUpdateMs: 0,
		logger: silent,
	});
	return { tracker, ...fake };
}

describe("ClickUpIssueTrackerService", () => {
	it("maps a task onto a Linear-shaped issue", async () => {
		const { tracker } = setup(
			clickUpTask({
				assignees: [AGENT],
				tags: [{ name: "nyrus" }, { name: "bug" }],
				attachments: [
					{ id: "a1", title: "screen.png", url: "https://files/x" },
				],
			}),
		);
		const issue = await tracker.fetchIssue(`CU-${TASK}`);

		expect(issue).toMatchObject({
			id: TASK,
			identifier: `CU-${TASK}`,
			title: "Mobile menu broken",
			url: `https://app.clickup.com/t/${TASK}`,
			branchName: `CU-${TASK}-mobile-menu-broken`,
			assigneeId: "900",
			stateId: "to do",
			teamId: SPACE_ID,
			labelIds: ["nyrus", "bug"],
			priority: 2,
		});
		expect(issue.description).toBe(
			"## Steps\n\n- open the **shop**\n- tap `menu`\n\n---\nAttached files (download them with the clickup tool download_attachments): screen.png",
		);
		expect(await issue.state).toMatchObject({
			id: "to do",
			type: "unstarted",
		});
		expect(await issue.team).toMatchObject({
			id: SPACE_ID,
			key: SPACE_ID,
			name: "nyrus Sandbox",
		});
		expect(await issue.project).toEqual({
			id: LIST.id,
			name: "Tests",
		});
	});

	it("maps statuses onto Linear state types, in order", async () => {
		const { tracker } = setup();
		const { nodes } = await tracker.fetchWorkflowStates(SPACE_ID);
		expect(nodes.map((s) => [s.id, s.type, s.position])).toEqual([
			["to do", "unstarted", 0],
			["in progress", "started", 1],
			["in review", "started", 2],
			["complete", "completed", 3],
		]);
	});

	it("sets a status by name, or the List's status of the same type", async () => {
		const own = {
			...LIST,
			statuses: [
				{ status: "backlog", type: "open", orderindex: 0 },
				{ status: "doing", type: "custom", orderindex: 1 },
				{ status: "done", type: "closed", orderindex: 2 },
			],
		};
		const { tracker, calls } = setup(clickUpTask(), {
			[`GET /list/${LIST.id}`]: own,
		});
		await tracker.fetchWorkflowStates(SPACE_ID);
		await tracker.updateIssue(TASK, { stateId: "in progress" });
		await tracker.updateIssue(TASK, { stateId: "Done" });

		expect(calls.filter((c) => c.method === "PUT").map((c) => c.body)).toEqual([
			{ status: "doing" },
			{ status: "done" },
		]);
	});

	it("adds and removes tags to match the labels", async () => {
		const { tracker, calls } = setup(
			clickUpTask({ tags: [{ name: "nyrus" }, { name: "old" }] }),
			{
				[`POST /task/${TASK}/tag/new`]: {},
				[`DELETE /task/${TASK}/tag/old`]: {},
			},
		);
		await tracker.updateIssue(TASK, { labelIds: ["NYRUS", "new"] });
		expect(
			calls
				.filter((c) => c.path.includes("/tag/"))
				.map((c) => `${c.method} ${c.path}`),
		).toEqual([`POST /task/${TASK}/tag/new`, `DELETE /task/${TASK}/tag/old`]);
	});

	it("writes title, description and priority", async () => {
		const { tracker, calls } = setup();
		await tracker.updateIssue(TASK, {
			title: "New title",
			description: "**Steps**",
			priority: 1,
		});
		expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
			name: "New title",
			markdown_content: "**Steps**",
			priority: 1,
		});
	});

	it("posts the agent's activities as signed rich text comments", async () => {
		const { tracker, calls } = setup(clickUpTask(), {
			[`POST /task/${TASK}/comment`]: { id: 1500750000060620 },
		});
		const result = await tracker.createAgentActivity({
			agentSessionId: `clickup-${TASK}`,
			content: { type: "response", body: "Fixed it in **PR #20**." },
		} as never);

		expect((await result.agentActivity)?.id).toBe("1500750000060620");
		expect(calls.find((c) => c.method === "POST")?.body).toEqual({
			notify_all: false,
			comment: [
				{ text: "🤖 nyrus:", attributes: { bold: true } },
				{ text: "\n" },
				{ text: "Fixed it in " },
				{ text: "PR #20", attributes: { bold: true } },
				{ text: "." },
				{ text: "\n" },
			],
		});
		expect(tracker.isOwnComment("1500750000060620")).toBe(true);
	});

	it("edits comments with rich text and plain text", async () => {
		const { tracker, calls } = setup(clickUpTask(), {
			"PUT /comment/c-1": {},
		});
		await tracker.updateComment(TASK, "c-1", "Running `tests`");
		expect(calls[0]).toEqual({
			method: "PUT",
			path: "/comment/c-1",
			body: {
				comment: [
					{ text: "🤖 nyrus:", attributes: { bold: true } },
					{ text: "\n" },
					{ text: "Running " },
					{ text: "tests", attributes: { code: true } },
					{ text: "\n" },
				],
				comment_text: "🤖 nyrus:\nRunning tests\n",
			},
		});
	});

	it("reads comments oldest first, as Markdown", async () => {
		const { tracker } = setup(clickUpTask(), {
			[`GET /task/${TASK}/comment`]: {
				comments: [
					{
						id: 2,
						comment: [{ text: "second", attributes: { italic: true } }],
						user: AGENT,
						date: "1794574317000",
					},
					{ id: 1, comment_text: "first", date: "1794574316000" },
				],
			},
		});
		const { nodes } = await tracker.fetchComments(TASK);
		expect(nodes.map((c) => [c.id, c.body])).toEqual([
			["1", "first"],
			["2", "_second_"],
		]);
	});

	it("knows people it has seen, and the token's person", async () => {
		const { tracker } = setup();
		await tracker.fetchTask(TASK);
		expect(await tracker.fetchUser("42")).toMatchObject({
			id: "42",
			name: "Simon",
			email: "simon@novu.ch",
		});
		expect(await tracker.fetchUser("900")).toMatchObject({
			email: "token@novu.ch",
		});
		expect(await tracker.fetchUser("7")).toMatchObject({ id: "7" });
	});

	it("lists only the configured Spaces as teams", async () => {
		const { tracker } = setup();
		const { nodes } = await tracker.fetchTeams();
		expect(nodes.map((t) => [t.id, t.key, t.name])).toEqual([
			[SPACE_ID, SPACE_ID, "nyrus Sandbox"],
		]);
	});
});

describe("branchName", () => {
	it("names CU-<id> so ClickUp's GitHub integration links it", () => {
		expect(branchName("86c1abcde", "Fix login on mobile (iOS)!")).toBe(
			"CU-86c1abcde-fix-login-on-mobile-ios",
		);
		expect(branchName("86c1abcde", "Überprüfung")).toBe(
			"CU-86c1abcde-uberprufung",
		);
		expect(branchName("86c1abcde", "???")).toBe("CU-86c1abcde");
	});
});

describe("createClickUpIntegrationFactory", () => {
	it("runs sessions with a token, scoped to the configured Spaces", () => {
		const integration = createClickUpIntegrationFactory()({
			env: {
				CLICKUP_WEBHOOK_SECRET: "secret",
				CLICKUP_API_TOKEN: "pk_test",
				CLICKUP_TEAM_ID: "14278081",
				CLICKUP_SPACE_IDS: " 1, 2 ,",
			},
			cyrusHome: "/tmp",
			logger: silent,
		})!;
		const tracker = integration.tracker as ClickUpIssueTrackerService;
		expect(integration.workspaceKey).toBe("clickup-14278081");
		expect(tracker.options).toMatchObject({
			triggerTag: "nyrus",
			triggerOnAssign: false,
			spaceIds: ["1", "2"],
		});
		const server = integration.mcpServers?.().clickup;
		expect(server?.env).toEqual({
			CLICKUP_API_TOKEN: "pk_test",
			CLICKUP_TEAM_ID: "14278081",
		});
		expect(server?.args[0]).toMatch(/mcp[/\\]stdio\.js$/);
		integration.dispose?.();
	});

	it("reads the trigger settings", () => {
		const integration = createClickUpIntegrationFactory()({
			env: {
				CLICKUP_WEBHOOK_SECRET: "secret",
				CLICKUP_API_TOKEN: "pk_test",
				CLICKUP_TRIGGER_TAG: "",
				CLICKUP_TRIGGER_ON_ASSIGN: "TRUE",
			},
			cyrusHome: "/tmp",
			logger: silent,
		})!;
		expect(integration.workspaceKey).toBe("clickup");
		expect(
			(integration.tracker as ClickUpIssueTrackerService).options,
		).toMatchObject({ triggerTag: "", triggerOnAssign: true, spaceIds: [] });
		integration.dispose?.();
	});
});
