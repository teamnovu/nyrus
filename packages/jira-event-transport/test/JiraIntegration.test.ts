import {
	HANDED_BACK_PROMPT,
	type LinearShapedWebhook,
	type SessionState,
} from "cyrus-comment-sessions";
import { describe, expect, it } from "vitest";
import { jiraEventHandler } from "../src/JiraIntegration.js";
import { JiraIssueTrackerService } from "../src/JiraIssueTrackerService.js";
import { signed } from "../src/JiraText.js";
import type { JiraIssue, JiraWebhookEvent } from "../src/types.js";
import { AGENT, fakeJira, jiraIssue } from "./fakeJira.js";

function setup(
	issue: JiraIssue,
	known: string[] = [],
	options: {
		triggerOnAssign?: boolean;
		/** What the edge worker does with a webhook (default: returns at once). */
		handle?: (w: LinearShapedWebhook) => Promise<void>;
		routes?: Record<string, unknown>;
		/** Sessions waiting for the user's answer. */
		awaiting?: string[];
	} = {},
) {
	const { api, calls } = fakeJira({
		"GET /myself": AGENT,
		"GET /issue/ZOO-12": issue,
		...options.routes,
	});
	const tracker = new JiraIssueTrackerService(api, "jira-novu", {
		triggerLabel: "nyrus",
		triggerOnAssign: options.triggerOnAssign ?? true,
		dispatchTiming: { promptSettleMs: 5, startPollMs: 1, startSettleMaxMs: 20 },
	});
	const dispatched: LinearShapedWebhook[] = [];
	const sessionState = (id: string): SessionState =>
		options.awaiting?.includes(id)
			? "awaiting-input"
			: known.includes(id)
				? "idle"
				: "unknown";
	const sessions = tracker.sessions.createCoordinator({
		fastify: {} as never,
		dispatch: async (w) => {
			dispatched.push(w);
			await options.handle?.(w);
		},
		getSessionState: sessionState,
		logger: silent,
	});
	// The path the integration's webhook takes: Jira event -> shared coordinator.
	const coordinator = { handle: jiraEventHandler(tracker, sessions, silent) };
	return { coordinator, dispatched, calls };
}

const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
} as never;

function issueEvent(
	items: JiraWebhookEvent["changelog"],
	webhookEvent = "jira:issue_updated",
): JiraWebhookEvent {
	return {
		kind: "issue",
		webhookEvent,
		issueKey: "ZOO-12",
		changelog: items,
		actor: { accountId: "simon", displayName: "Simon" },
	};
}

function commentEvent(body: string, id = "c-1"): JiraWebhookEvent {
	return {
		kind: "comment",
		webhookEvent: "comment_created",
		issueKey: "ZOO-12",
		changelog: [],
		comment: { id, body, authorAccountId: "simon", authorName: "Simon" },
	};
}

const labelled = jiraIssue({ labels: ["nyrus"] });
const labelAdded = { field: "labels", fromString: "", toString: "nyrus" };
const labelRemoved = { field: "labels", fromString: "nyrus", toString: "" };

describe("Jira on cyrus-comment-sessions", () => {
	it("starts a delegation when the trigger label is added", async () => {
		const { coordinator, dispatched } = setup(labelled);
		await coordinator.handle(issueEvent([labelAdded]));

		expect(dispatched).toHaveLength(1);
		const webhook = dispatched[0]!;
		expect(webhook.action).toBe("created");
		expect(webhook.organizationId).toBe("jira-novu");
		expect(webhook.agentSession).toMatchObject({
			id: "jira-10001",
			issueId: "10001",
			issue: {
				identifier: "ZOO-12",
				title: "Mobile menu broken",
				url: "http://jira.localhost/browse/ZOO-12",
				team: { id: "100", key: "ZOO", name: "Zoo Test" },
			},
			creator: { id: "simon", name: "Simon" },
		});
		expect(webhook.agentSession).not.toHaveProperty("comment");
	});

	it("starts a delegation when the issue is assigned to the agent", async () => {
		const { coordinator, dispatched } = setup(
			jiraIssue({ assignee: { accountId: "agent-1" } }),
		);
		await coordinator.handle(
			issueEvent([{ field: "assignee", from: null, to: "agent-1" }]),
		);
		expect(dispatched.map((w) => w.action)).toEqual(["created"]);
	});

	it("ignores updates of issues not handed to the agent", async () => {
		const { coordinator, dispatched } = setup(jiraIssue());
		await coordinator.handle(
			issueEvent([{ field: "summary", fromString: "a", toString: "b" }]),
		);
		expect(dispatched).toEqual([]);
	});

	it("does not tell a new session it was handed back when a second hand-over follows", async () => {
		const { coordinator, dispatched } = setup(
			jiraIssue({ labels: ["nyrus"], assignee: { accountId: "agent-1" } }),
		);
		await coordinator.handle(issueEvent([labelAdded]));
		await coordinator.handle(
			issueEvent([{ field: "assignee", from: null, to: "agent-1" }]),
		);
		expect(dispatched.map((w) => w.action)).toEqual(["created"]);
	});

	it("continues an earlier session when the issue is handed back", async () => {
		const { coordinator, dispatched } = setup(labelled, ["jira-10001"]);
		await coordinator.handle(issueEvent([labelAdded]));
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]!.action).toBe("prompted");
		expect(dispatched[0]!.agentActivity).toMatchObject({
			agentSessionId: "jira-10001",
			content: { type: "prompt", body: HANDED_BACK_PROMPT },
		});
	});

	it("stops the session when the label is removed", async () => {
		const { coordinator, dispatched } = setup(jiraIssue(), ["jira-10001"]);
		await coordinator.handle(issueEvent([labelRemoved]));
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]!.agentActivity).toMatchObject({ signal: "stop" });
	});

	it("starts a conversation on a comment that mentions the agent", async () => {
		const { coordinator, dispatched } = setup(jiraIssue());
		await coordinator.handle(
			commentEvent("[~accountid:agent-1] why is the menu *broken*?"),
		);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]!.action).toBe("created");
		expect(dispatched[0]!.agentSession).toMatchObject({
			comment: { id: "c-1", body: "why is the menu **broken**?" },
		});
	});

	it("feeds comments into the session while the issue is handed over", async () => {
		const { coordinator, dispatched } = setup(labelled, ["jira-10001"]);
		await coordinator.handle(commentEvent("Also fix the footer", "c-2"));
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]!.action).toBe("prompted");
		expect(dispatched[0]!.agentActivity).toMatchObject({
			content: { type: "prompt", body: "Also fix the footer" },
			sourceCommentId: "c-2",
		});
	});

	it("passes on an unmentioned answer to a question Nyrus asked", async () => {
		const { coordinator, dispatched } = setup(jiraIssue(), ["jira-10001"], {
			awaiting: ["jira-10001"],
		});
		await coordinator.handle(
			commentEvent("https://github.com/teamnovu/sayflowers", "c-3"),
		);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]!.agentActivity).toMatchObject({
			content: { body: "https://github.com/teamnovu/sayflowers" },
			sourceCommentId: "c-3",
		});
	});

	it("passes a comment on once, even if Jira delivers it twice", async () => {
		const { coordinator, dispatched } = setup(labelled, ["jira-10001"]);
		await coordinator.handle(commentEvent("Also fix the footer", "c-7"));
		await coordinator.handle(commentEvent("Also fix the footer", "c-7"));
		expect(dispatched).toHaveLength(1);
	});

	it("ignores unmentioned comments once the issue is no longer handed over", async () => {
		const { coordinator, dispatched } = setup(jiraIssue(), ["jira-10001"]);
		await coordinator.handle(commentEvent("Looks good, thanks"));
		expect(dispatched).toEqual([]);
	});

	it("ignores its own comments without calling Jira", async () => {
		const { coordinator, dispatched, calls } = setup(labelled, ["jira-10001"]);
		await coordinator.handle(commentEvent(signed("Done, see the PR.")));
		expect(dispatched).toEqual([]);
		expect(calls).toEqual([]);
	});

	it("lets a follow-up through while the agent run is still going", async () => {
		const { coordinator, dispatched } = setup(labelled, [], {
			// The edge worker returns only when the run ends; this one doesn't.
			handle: () => new Promise(() => {}),
		});
		await coordinator.handle(issueEvent([labelAdded]));
		await coordinator.handle(commentEvent("Also fix the footer", "c-2"));
		expect(dispatched.map((w) => w.action)).toEqual(["created", "prompted"]);
	});

	it("treats a hand-over right after a stop as handing the issue back", async () => {
		const issue = jiraIssue({ labels: ["nyrus"] });
		const known: string[] = [];
		const { coordinator, dispatched } = setup(issue, known);
		await coordinator.handle(issueEvent([labelAdded]));
		known.push("jira-10001"); // the edge worker now has the session
		issue.fields.labels = [];
		await coordinator.handle(issueEvent([labelRemoved]));
		issue.fields.labels = ["nyrus"];
		await coordinator.handle(issueEvent([labelAdded]));

		expect(dispatched.map((w) => w.action)).toEqual([
			"created",
			"prompted",
			"prompted",
		]);
		expect(dispatched[1]!.agentActivity).toMatchObject({ signal: "stop" });
		expect(dispatched[2]!.agentActivity).toMatchObject({
			content: { body: HANDED_BACK_PROMPT },
		});
	});

	it("ignores assignment when assigning doesn't hand issues over", async () => {
		const { coordinator, dispatched } = setup(
			jiraIssue({ labels: ["nyrus"], assignee: { accountId: "agent-1" } }),
			["jira-10001"],
			{ triggerOnAssign: false },
		);
		await coordinator.handle(
			issueEvent([{ field: "assignee", from: null, to: "agent-1" }]),
		);
		expect(dispatched).toEqual([]);
	});

	it("gives user access control the comment author's email", async () => {
		const { coordinator, dispatched } = setup(labelled, ["jira-10001"], {
			routes: {
				"GET /user": {
					accountId: "simon",
					displayName: "Simon",
					emailAddress: "simon@novu.ch",
				},
			},
		});
		await coordinator.handle(commentEvent("Also fix the footer"));
		expect(dispatched[0]!.agentSession).toMatchObject({
			creator: { id: "simon", name: "Simon", email: "simon@novu.ch" },
		});
	});
});
