import { describe, expect, it } from "vitest";
import { JiraIssueTrackerService } from "../src/JiraIssueTrackerService.js";
import { signed } from "../src/JiraText.js";
import {
	HANDED_BACK_PROMPT,
	JiraWebhookCoordinator,
	type LinearShapedAgentSessionWebhook,
} from "../src/JiraWebhookCoordinator.js";
import type { JiraIssue, JiraWebhookEvent } from "../src/types.js";
import { AGENT, fakeJira, jiraIssue } from "./fakeJira.js";

function setup(issue: JiraIssue, known: string[] = []) {
	const { api, calls } = fakeJira({
		"GET /myself": AGENT,
		"GET /issue/ZOO-12": issue,
	});
	const tracker = new JiraIssueTrackerService(api, "jira-novu", {
		triggerLabel: "nyrus",
		triggerOnAssign: true,
	});
	const dispatched: LinearShapedAgentSessionWebhook[] = [];
	const coordinator = new JiraWebhookCoordinator({
		tracker,
		isKnownSession: (id) => known.includes(id),
		dispatch: (w) => {
			dispatched.push(w);
		},
	});
	return { coordinator, dispatched, calls };
}

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

describe("JiraWebhookCoordinator", () => {
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
});
