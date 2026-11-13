import { describe, expect, it } from "vitest";
import {
	CommentSessionCoordinator,
	HANDED_BACK_PROMPT,
} from "../src/CommentSessionCoordinator.js";
import { SessionStore } from "../src/SessionStore.js";
import type {
	CommentTrackerEvent,
	LinearShapedWebhook,
	SessionState,
} from "../src/types.js";
import { fakeTracker } from "./fakeTracker.js";

const SESSION = "fake-t-1";

function setup(
	options: {
		handedOver?: boolean;
		/** Session states the edge worker reports. */
		states?: Record<string, SessionState>;
		/** What the edge worker does with a webhook (default: returns at once). */
		handle?: (w: LinearShapedWebhook) => Promise<void>;
	} = {},
) {
	const tracker = fakeTracker();
	tracker.state.handedOver = options.handedOver ?? false;
	const store = new SessionStore();
	const states = options.states ?? {};
	const dispatched: LinearShapedWebhook[] = [];
	const coordinator = new CommentSessionCoordinator({
		tracker,
		store,
		getSessionState: (id) => states[id] ?? "unknown",
		dispatch: (w) => {
			dispatched.push(w);
			return options.handle?.(w);
		},
		timing: { promptSettleMs: 5, startPollMs: 1, startSettleMaxMs: 20 },
	});
	return { coordinator, dispatched, states, store, tracker };
}

let counter = 0;
const changed = (
	handOver?: "added" | "removed",
	eventId?: string,
): CommentTrackerEvent => ({
	kind: "issue",
	issueId: "TCK-1",
	handOver,
	eventId,
	actor: { id: "u-1", name: "Simon" },
});
const comment = (
	body: string,
	extra: { mentionsAgent?: boolean; own?: boolean; id?: string } = {},
): CommentTrackerEvent => ({
	kind: "comment",
	issueId: "TCK-1",
	commentId: extra.id ?? `cm-${++counter}`,
	body,
	mentionsAgent: extra.mentionsAgent ?? false,
	own: extra.own,
	actor: { id: "u-1", name: "Simon" },
});

type Session = {
	id: string;
	comment?: { id: string; body: string };
	creator?: { id: string; name: string; email: string };
	issue: { identifier: string; team: { key: string } };
};
type Activity = { content: { body: string }; signal?: string };
const session = (w: LinearShapedWebhook) => w.agentSession as Session;
const activity = (w: LinearShapedWebhook) => w.agentActivity as Activity;

describe("CommentSessionCoordinator", () => {
	it("starts a delegation when the ticket is handed over", async () => {
		const { coordinator, dispatched } = setup({ handedOver: true });
		await coordinator.handle(changed("added"));

		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]).toMatchObject({
			type: "AgentSessionEvent",
			action: "created",
			organizationId: "fake-ws",
		});
		expect(session(dispatched[0]!).id).toBe(SESSION);
		expect(session(dispatched[0]!).comment).toBeUndefined();
		expect(session(dispatched[0]!).issue).toMatchObject({
			identifier: "TCK-1",
			team: { key: "WEB" },
		});
	});

	it("starts a handed-over ticket on any change, not only the hand-over itself", async () => {
		const { coordinator, dispatched } = setup({ handedOver: true });
		await coordinator.handle(changed());
		expect(dispatched.map((w) => w.action)).toEqual(["created"]);
	});

	it("ignores changes of tickets not handed over", async () => {
		const { coordinator, dispatched } = setup();
		await coordinator.handle(changed());
		expect(dispatched).toEqual([]);
	});

	it("does not tell a new session it was handed back when a second hand-over follows", async () => {
		const { coordinator, dispatched, states } = setup({ handedOver: true });
		await coordinator.handle(changed("added"));
		states[SESSION] = "working";
		await coordinator.handle(changed("added")); // label and assignee in one go
		expect(dispatched.map((w) => w.action)).toEqual(["created"]);
	});

	it("continues an earlier session when the ticket is handed back", async () => {
		const { coordinator, dispatched } = setup({
			handedOver: true,
			states: { [SESSION]: "idle" },
		});
		await coordinator.handle(changed("added"));
		expect(dispatched.map((w) => w.action)).toEqual(["prompted"]);
		expect(activity(dispatched[0]!).content.body).toBe(HANDED_BACK_PROMPT);
	});

	it("stops the session when the ticket is taken away", async () => {
		const { coordinator, dispatched } = setup({
			states: { [SESSION]: "working" },
		});
		await coordinator.handle(changed("removed"));
		expect(dispatched[0]!.action).toBe("prompted");
		expect(activity(dispatched[0]!)).toMatchObject({
			signal: "stop",
			content: { body: "stop" },
		});
	});

	it("treats a hand-over right after a stop as handing the ticket back", async () => {
		const { coordinator, dispatched, states, tracker } = setup({
			handedOver: true,
		});
		await coordinator.handle(changed("added"));
		states[SESSION] = "working";
		tracker.state.handedOver = false;
		await coordinator.handle(changed("removed"));
		tracker.state.handedOver = true;
		await coordinator.handle(changed("added"));

		expect(dispatched.map((w) => w.action)).toEqual([
			"created",
			"prompted",
			"prompted",
		]);
		expect(activity(dispatched[1]!).signal).toBe("stop");
		expect(activity(dispatched[2]!).content.body).toBe(HANDED_BACK_PROMPT);
	});

	it("starts a conversation on a comment that mentions the agent", async () => {
		const { coordinator, dispatched } = setup();
		await coordinator.handle(
			comment("why is login broken?", { mentionsAgent: true, id: "cm-x" }),
		);
		expect(dispatched[0]!.action).toBe("created");
		expect(session(dispatched[0]!).comment).toEqual({
			id: "cm-x",
			body: "why is login broken?",
		});
	});

	it("ignores comments without a mention on tickets without a session", async () => {
		const { coordinator, dispatched } = setup();
		await coordinator.handle(comment("@Anna can you look?"));
		expect(dispatched).toEqual([]);
	});

	it("feeds comments into the session while the ticket is handed over", async () => {
		const { coordinator, dispatched } = setup({
			handedOver: true,
			states: { [SESSION]: "working" },
		});
		await coordinator.handle(comment("also add a test"));
		expect(dispatched[0]!.action).toBe("prompted");
		expect(activity(dispatched[0]!).content.body).toBe("also add a test");
	});

	it("passes on an unmentioned answer to a question, resolving a numbered reply", async () => {
		const { coordinator, dispatched, store } = setup({
			states: { [SESSION]: "awaiting-input" },
		});
		store.setQuestion(SESSION, [
			{ value: "github.com/novu/web" },
			{ value: "github.com/novu/api", label: "API" },
		]);
		await coordinator.handle(comment("2"));
		expect(activity(dispatched[0]!).content.body).toBe("github.com/novu/api");
	});

	it("ignores unmentioned comments once the ticket is no longer handed over", async () => {
		const { coordinator, dispatched } = setup({
			states: { [SESSION]: "idle" },
		});
		await coordinator.handle(comment("thanks!"));
		expect(dispatched).toEqual([]);
	});

	it("resumes a finished session when the agent is mentioned again", async () => {
		const { coordinator, dispatched } = setup({
			states: { [SESSION]: "idle" },
		});
		await coordinator.handle(
			comment("now update the docs", { mentionsAgent: true }),
		);
		expect(dispatched.map((w) => w.action)).toEqual(["prompted"]);
	});

	it("ignores its own comments without reading the ticket", async () => {
		const { coordinator, dispatched, store, tracker } = setup({
			handedOver: true,
			states: { [SESSION]: "working" },
		});
		store.rememberOwnComment("mine");
		await coordinator.handle(comment("Done, see the PR.", { id: "mine" }));
		await coordinator.handle(comment("🤖 nyrus: Done", { own: true }));
		expect(dispatched).toEqual([]);
		expect(tracker.fetchIssueState).not.toHaveBeenCalled();
	});

	it("lets a follow-up through while the agent run is still going", async () => {
		const { coordinator, dispatched, states, tracker } = setup({
			handedOver: true,
			// The edge worker returns only when the run ends; this one doesn't.
			handle: async () => {
				states[SESSION] = "working";
				return new Promise(() => {});
			},
		});
		await coordinator.handle(changed("added"));
		await coordinator.handle(comment("also fix the footer"));
		await coordinator.handle(comment("stop"));
		expect(dispatched.map((w) => w.action)).toEqual([
			"created",
			"prompted",
			"prompted",
		]);
		expect(tracker.fetchIssueState).toHaveBeenCalledTimes(3);
	});

	it("drops retried deliveries, but retries an event that failed", async () => {
		const { coordinator, dispatched, tracker } = setup({ handedOver: true });
		tracker.fetchIssueState.mockRejectedValueOnce(new Error("ClickUp 502"));
		await coordinator.handle(changed("added", "h-1")); // fails
		await coordinator.handle(changed("added", "h-1")); // redelivered: handled
		await coordinator.handle(changed("added", "h-1")); // retried again: dropped
		expect(dispatched.map((w) => w.action)).toEqual(["created"]);
	});

	it("keeps the starting comment in later webhooks, so a repository pick doesn't lose the request", async () => {
		const { coordinator, dispatched, states, store } = setup();
		await coordinator.handle(
			comment("why is login broken?", { mentionsAgent: true, id: "cm-ask" }),
		);
		// The edge worker asks which repository; the user answers "1".
		states[SESSION] = "awaiting-input";
		store.setQuestion(SESSION, [{ value: "web" }, { value: "api" }]);
		await coordinator.handle(comment("1"));

		expect(dispatched.map((w) => w.action)).toEqual(["created", "prompted"]);
		expect(session(dispatched[1]!).comment).toEqual({
			id: "cm-ask",
			body: "why is login broken?",
		});
		expect(activity(dispatched[1]!).content.body).toBe("web");
	});

	it("hands a ticket over right after a mention started a conversation", async () => {
		const { coordinator, dispatched, states, tracker } = setup();
		await coordinator.handle(
			comment("what does this do?", { mentionsAgent: true }),
		);
		states[SESSION] = "working";
		tracker.state.handedOver = true;
		await coordinator.handle(changed("added"));
		expect(dispatched.map((w) => w.action)).toEqual(["created", "prompted"]);
		expect(activity(dispatched[1]!).content.body).toBe(HANDED_BACK_PROMPT);
	});

	it("resumes a quickly finished delegation when it is handed over again", async () => {
		const { coordinator, dispatched, states } = setup({ handedOver: true });
		await coordinator.handle(changed("added"));
		states[SESSION] = "idle";
		await coordinator.handle(changed("added"));
		expect(dispatched.map((w) => w.action)).toEqual(["created", "prompted"]);
	});

	it("starts the session on a retry if starting it failed", async () => {
		const { coordinator, dispatched, tracker } = setup({ handedOver: true });
		const { issue } = await tracker.fetchIssueState("TCK-1");
		tracker.fetchIssueState.mockResolvedValueOnce({
			issue: { ...issue, team: Promise.reject(new Error("502")) } as never,
			handedOver: true,
		});
		await coordinator.handle(changed("added", "h-9")); // fails before dispatch
		await coordinator.handle(changed("added", "h-9")); // redelivered
		expect(dispatched.map((w) => w.action)).toEqual(["created"]);
	});

	it("gives user access control the actor's email, and keeps the id if the lookup fails", async () => {
		const { coordinator, dispatched, tracker } = setup({
			handedOver: true,
			states: { [SESSION]: "working" },
		});
		await coordinator.handle(comment("also fix the footer"));
		expect(session(dispatched[0]!).creator).toEqual({
			id: "u-1",
			name: "Simon",
			email: "ada@example.com",
		});

		tracker.fetchUser = (async () => {
			throw new Error("not allowed");
		}) as never;
		await coordinator.handle(comment("and the header"));
		expect(session(dispatched[1]!).creator).toEqual({
			id: "u-1",
			name: "Simon",
			email: "",
		});
	});
});
