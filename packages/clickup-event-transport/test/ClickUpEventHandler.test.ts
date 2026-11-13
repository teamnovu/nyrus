import {
	HANDED_BACK_PROMPT,
	type LinearShapedWebhook,
	type SessionState,
} from "cyrus-comment-sessions";
import { describe, expect, it } from "vitest";
import {
	ClickUpEventHandler,
	handOverChange,
} from "../src/ClickUpEventHandler.js";
import { ClickUpIssueTrackerService } from "../src/ClickUpIssueTrackerService.js";
import type { ClickUpTask, ClickUpWebhookPayload } from "../src/types.js";
import {
	AGENT,
	clickUpTask,
	fakeClickUp,
	SIMON,
	SPACE,
	SPACE_ID,
} from "./fakeClickUp.js";

const TASK = "1amxjbadtjm";
const SESSION = `clickup-${TASK}`;

const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as never;

function setup(
	initial: ClickUpTask,
	options: {
		known?: string[];
		awaiting?: string[];
		triggerOnAssign?: boolean;
		spaceIds?: string[];
		routes?: Record<string, unknown>;
	} = {},
) {
	let task = initial;
	const { api, calls } = fakeClickUp({
		"GET /user": { user: AGENT },
		[`GET /task/${TASK}`]: () => task,
		[`GET /space/${SPACE_ID}`]: SPACE,
		...options.routes,
	});
	const tracker = new ClickUpIssueTrackerService(api, "clickup-14278081", {
		triggerTag: "nyrus",
		triggerOnAssign: options.triggerOnAssign ?? false,
		spaceIds: options.spaceIds ?? [SPACE_ID],
		dispatchTiming: { promptSettleMs: 5, startPollMs: 1, startSettleMaxMs: 20 },
		logger: silent,
	});
	const dispatched: LinearShapedWebhook[] = [];
	const state = (id: string): SessionState =>
		options.awaiting?.includes(id)
			? "awaiting-input"
			: options.known?.includes(id)
				? "idle"
				: "unknown";
	const coordinator = tracker.sessions.createCoordinator({
		fastify: {} as never,
		dispatch: async (w) => {
			dispatched.push(w);
		},
		getSessionState: state,
		logger: silent,
	});
	const handler = new ClickUpEventHandler(tracker, coordinator, silent);
	return {
		handler,
		tracker,
		dispatched,
		calls,
		setTask: (next: ClickUpTask) => {
			task = next;
		},
	};
}

let historyId = 0;
function delivery(
	event: string,
	items: Array<Record<string, unknown>>,
): ClickUpWebhookPayload {
	return {
		event,
		task_id: TASK,
		webhook_id: "wh-1",
		history_items: items.map((item) => ({
			id: String(++historyId),
			user: SIMON,
			...item,
		})),
	};
}

const tagged = clickUpTask({ tags: [{ name: "nyrus" }] });
const tagAdded = () =>
	delivery("taskTagUpdated", [
		{ field: "tag", before: null, after: [{ name: "nyrus" }] },
	]);
const tagRemoved = () =>
	delivery("taskTagUpdated", [
		{ field: "tag_removed", before: null, after: [{ name: "nyrus" }] },
	]);
function commentPosted(text: string, id = "c-1") {
	return delivery("taskCommentPosted", [
		{
			field: "comment",
			after: id,
			comment: {
				id,
				comment: [{ text }],
				text_content: text,
				user: SIMON,
			},
		},
	]);
}

describe("ClickUp deliveries on cyrus-comment-sessions", () => {
	it("starts a delegation when the trigger tag is added", async () => {
		const { handler, dispatched } = setup(tagged);
		await handler.handle(tagAdded());

		expect(dispatched).toHaveLength(1);
		const webhook = dispatched[0]!;
		expect(webhook.action).toBe("created");
		expect(webhook.organizationId).toBe("clickup-14278081");
		expect(webhook.agentSession).toMatchObject({
			id: SESSION,
			issueId: TASK,
			issue: {
				identifier: `CU-${TASK}`,
				title: "Mobile menu broken",
				url: `https://app.clickup.com/t/${TASK}`,
				team: { id: SPACE_ID, key: SPACE_ID, name: "nyrus Sandbox" },
			},
			creator: { id: "42", name: "Simon", email: "simon@novu.ch" },
		});
		expect(webhook.agentSession).not.toHaveProperty("comment");
	});

	it("starts a conversation on a /nyrus comment, without the command", async () => {
		const { handler, dispatched } = setup(clickUpTask());
		await handler.handle(commentPosted("/nyrus why is the menu broken?"));

		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]!.action).toBe("created");
		expect(dispatched[0]!.agentSession).toMatchObject({
			id: SESSION,
			comment: { id: "c-1", body: "why is the menu broken?" },
		});
	});

	it("ignores ordinary comments on a task without a session", async () => {
		const { handler, dispatched } = setup(clickUpTask());
		await handler.handle(commentPosted("looks good to me"));
		expect(dispatched).toHaveLength(0);
	});

	it("passes every comment on a handed-over task to its session", async () => {
		const { handler, dispatched } = setup(tagged, { known: [SESSION] });
		await handler.handle(commentPosted("**also** fix the footer", "c-2"));

		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]).toMatchObject({
			action: "prompted",
			agentActivity: {
				content: { type: "prompt", body: "**also** fix the footer" },
				sourceCommentId: "c-2",
			},
		});
	});

	it("ignores nyrus's own comments without reading the task", async () => {
		const { handler, dispatched, calls } = setup(tagged, { known: [SESSION] });
		await handler.handle(commentPosted("🤖 nyrus:\nDone."));
		expect(dispatched).toHaveLength(0);
		expect(calls).toHaveLength(0);
	});

	it("ignores comments it posted, by id", async () => {
		const { handler, tracker, dispatched } = setup(tagged, {
			known: [SESSION],
			routes: { [`POST /task/${TASK}/comment`]: { id: 1500750000060620 } },
		});
		const { id } = await tracker.sessions
			.createAgentActivity({
				agentSessionId: SESSION,
				content: { type: "response", body: "Done." },
			} as never)
			.then(async (r) => ({ id: (await r.agentActivity)?.id }));
		expect(id).toBe("1500750000060620");

		// Same id, but ClickUp's text without the signature line.
		await handler.handle(commentPosted("Done.", "1500750000060620"));
		expect(dispatched).toHaveLength(0);
	});

	it("reads the comment from the API when the delivery lacks it", async () => {
		const { handler, dispatched } = setup(clickUpTask(), {
			routes: {
				[`GET /task/${TASK}/comment`]: {
					comments: [
						{
							id: 77,
							comment: [
								{ text: "/nyrus " },
								{ text: "fix it", attributes: { bold: true } },
							],
							user: SIMON,
							date: "1794574316816",
						},
					],
				},
			},
		});
		await handler.handle(
			delivery("taskCommentPosted", [{ field: "comment", after: "77" }]),
		);
		expect(dispatched[0]!.agentSession).toMatchObject({
			comment: { id: "77", body: "**fix it**" },
		});
	});

	it("drops a retried delivery of the same comment", async () => {
		const { handler, dispatched } = setup(tagged, { known: [SESSION] });
		await handler.handle(commentPosted("go on", "c-9"));
		await handler.handle(commentPosted("go on", "c-9"));
		expect(dispatched).toHaveLength(1);
	});

	it("stops the session when the tag is removed", async () => {
		const { handler, dispatched } = setup(clickUpTask(), { known: [SESSION] });
		await handler.handle(tagRemoved());
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]).toMatchObject({
			action: "prompted",
			agentActivity: { content: { body: "stop" }, signal: "stop" },
		});
	});

	it("notices a hand-over the delivery doesn't name, from the task's last known state", async () => {
		const { handler, dispatched, setTask } = setup(clickUpTask(), {
			known: [SESSION],
		});
		await handler.handle(delivery("taskStatusUpdated", [{ field: "status" }]));
		expect(dispatched).toHaveLength(0);

		setTask(tagged);
		await handler.handle(delivery("taskUpdated", [{ field: "content" }]));
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]).toMatchObject({
			action: "prompted",
			agentActivity: { content: { body: HANDED_BACK_PROMPT } },
		});
	});

	it("ignores tasks outside the configured Spaces", async () => {
		const { handler, dispatched } = setup(
			clickUpTask({ tags: [{ name: "nyrus" }], space: { id: "other" } }),
		);
		await handler.handle(tagAdded());
		await handler.handle(commentPosted("/nyrus hello", "c-3"));
		expect(dispatched).toHaveLength(0);
	});

	it("ignores events that can't hand a task over", async () => {
		const { handler, dispatched, calls } = setup(tagged);
		await handler.handle(
			delivery("taskTimeTrackedUpdated", [{ field: "time_spent" }]),
		);
		await handler.handle(
			delivery("taskCommentUpdated", [{ field: "comment" }]),
		);
		expect(dispatched).toHaveLength(0);
		expect(calls).toHaveLength(0);
	});

	it("hands over by assignment only when that is turned on", async () => {
		const assigned = clickUpTask({ assignees: [AGENT] });
		const assign = () =>
			delivery("taskAssigneeUpdated", [
				{ field: "assignee_add", after: AGENT },
			]);

		const off = setup(assigned);
		await off.handler.handle(assign());
		expect(off.dispatched).toHaveLength(0);

		const on = setup(assigned, { triggerOnAssign: true });
		await on.handler.handle(assign());
		expect(on.dispatched.map((w) => w.action)).toEqual(["created"]);
	});
});

describe("handOverChange", () => {
	const options = { triggerTag: "Nyrus", triggerOnAssign: true };
	const item = (fields: Record<string, unknown>) => ({ id: "h", ...fields });

	it("reads tags added and removed, in either shape", () => {
		expect(
			handOverChange(
				[item({ field: "tag", after: [{ name: "nyrus" }] })],
				options,
				AGENT,
			),
		).toBe("added");
		expect(
			handOverChange(
				[item({ field: "tag", before: [{ name: "nyrus" }], after: [] })],
				options,
				AGENT,
			),
		).toBe("removed");
		expect(
			handOverChange(
				[item({ field: "tag_removed", before: [{ name: "NYRUS" }] })],
				options,
				AGENT,
			),
		).toBe("removed");
		expect(
			handOverChange(
				[item({ field: "tag", after: [{ name: "bug" }] })],
				options,
				AGENT,
			),
		).toBeUndefined();
	});

	it("reads the token's person being assigned or unassigned", () => {
		expect(
			handOverChange(
				[item({ field: "assignee_add", after: { id: 900 } })],
				options,
				AGENT,
			),
		).toBe("added");
		expect(
			handOverChange(
				[item({ field: "assignee_rem", before: 900 })],
				options,
				AGENT,
			),
		).toBe("removed");
		expect(
			handOverChange(
				[item({ field: "assignee_add", after: { id: 42 } })],
				options,
				AGENT,
			),
		).toBeUndefined();
	});
});
