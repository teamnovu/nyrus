import { describe, expect, it } from "vitest";
import { CommentSessionCoordinator } from "../src/CommentSessionCoordinator.js";
import { SessionDirectory } from "../src/SessionDirectory.js";
import type {
	CommentTrackerEvent,
	LinearShapedWebhook,
	SessionState,
} from "../src/types.js";
import { fakeTracker } from "./fakeTracker.js";

function setup(options: { followUpsWithoutMention?: boolean } = {}) {
	const tracker = fakeTracker();
	const directory = new SessionDirectory("fake");
	const states = new Map<string, SessionState>();
	const dispatched: LinearShapedWebhook[] = [];
	const coordinator = new CommentSessionCoordinator({
		tracker,
		directory,
		getSessionState: (id) => states.get(id) ?? "unknown",
		dispatch: (webhook) => {
			dispatched.push(webhook);
			// The edge worker starts a session for every created webhook.
			const session = webhook.agentSession as { id: string } | undefined;
			if (webhook.action === "created" && session) {
				states.set(session.id, "working");
			}
		},
		...options,
	});
	return { coordinator, dispatched, directory, states, tracker };
}

let eventCounter = 0;
const assigned = (actorId = "u-1"): CommentTrackerEvent => ({
	kind: "assigned",
	eventId: `e-${++eventCounter}`,
	issueId: "t-1",
	actorId,
});
const comment = (
	body: string,
	mentionsBot: boolean,
	actorId = "u-1",
): CommentTrackerEvent => ({
	kind: "comment",
	eventId: `e-${++eventCounter}`,
	issueId: "t-1",
	commentId: `cm-${eventCounter}`,
	body,
	mentionsBot,
	actorId,
});

type Session = {
	id: string;
	comment?: { id: string; body: string };
	creator?: { name: string };
	issue: { identifier: string; team: { key: string } };
};
type Activity = { content: { body: string }; signal?: string };

describe("CommentSessionCoordinator", () => {
	it("starts a delegation session when the bot is assigned", async () => {
		const { coordinator, dispatched } = setup();
		await coordinator.handle(assigned());

		expect(dispatched).toHaveLength(1);
		const webhook = dispatched[0]!;
		expect(webhook).toMatchObject({
			type: "AgentSessionEvent",
			action: "created",
			organizationId: "fake-ws",
		});
		const session = webhook.agentSession as Session;
		expect(session.id).toMatch(/^fake-/);
		expect(session.comment).toBeUndefined();
		expect(session.creator?.name).toBe("Ada");
		expect(session.issue.identifier).toBe("TCK-1");
		expect(session.issue.team.key).toBe("WEB");
	});

	it("ignores a second assignment while the session is working", async () => {
		const { coordinator, dispatched } = setup();
		await coordinator.handle(assigned());
		await coordinator.handle(assigned());
		expect(dispatched).toHaveLength(1);
	});

	it("starts a new session when assigned again after the last one finished", async () => {
		const { coordinator, dispatched, states } = setup();
		await coordinator.handle(assigned());
		const first = (dispatched[0]!.agentSession as Session).id;
		states.set(first, "idle");
		await coordinator.handle(assigned());

		expect(dispatched.map((w) => w.action)).toEqual(["created", "created"]);
		expect((dispatched[1]!.agentSession as Session).id).not.toBe(first);
	});

	it("drops retried deliveries and the bot's own events", async () => {
		const { coordinator, dispatched } = setup();
		const event = assigned();
		await coordinator.handle(event);
		await coordinator.handle(event);
		await coordinator.handle(comment("my own answer", true, "bot"));
		expect(dispatched).toHaveLength(1);
	});

	it("starts a conversational session on a mention", async () => {
		const { coordinator, dispatched } = setup();
		await coordinator.handle(comment("why is login broken?", true));

		expect(dispatched).toHaveLength(1);
		const session = dispatched[0]!.agentSession as Session;
		expect(dispatched[0]!.action).toBe("created");
		expect(session.comment).toEqual({
			id: expect.stringMatching(/^cm-/),
			body: "why is login broken?",
		});
	});

	it("ignores comments without a mention when no session works", async () => {
		const { coordinator, dispatched } = setup();
		await coordinator.handle(comment("@Anna can you look?", false));
		expect(dispatched).toHaveLength(0);
	});

	it("passes comments to a working session as follow-ups", async () => {
		const { coordinator, dispatched } = setup();
		await coordinator.handle(assigned());
		await coordinator.handle(comment("also add a test", false));

		expect(dispatched[1]).toMatchObject({ action: "prompted" });
		expect((dispatched[1]!.agentActivity as Activity).content.body).toBe(
			"also add a test",
		);
		expect((dispatched[1]!.agentSession as Session).id).toBe(
			(dispatched[0]!.agentSession as Session).id,
		);
	});

	it("only passes mentions when follow-ups without a mention are off", async () => {
		const { coordinator, dispatched } = setup({
			followUpsWithoutMention: false,
		});
		await coordinator.handle(assigned());
		await coordinator.handle(comment("talking to Anna", false));
		await coordinator.handle(comment("also add a test", true));
		expect(dispatched.map((w) => w.action)).toEqual(["created", "prompted"]);
	});

	it("resumes the finished session when the bot is mentioned again", async () => {
		const { coordinator, dispatched, states } = setup();
		await coordinator.handle(assigned());
		const id = (dispatched[0]!.agentSession as Session).id;
		states.set(id, "idle");
		await coordinator.handle(comment("thanks, ignored", false));
		await coordinator.handle(comment("now update the docs", true));

		expect(dispatched.map((w) => w.action)).toEqual(["created", "prompted"]);
		expect((dispatched[1]!.agentSession as Session).id).toBe(id);
	});

	it("starts a new session on a mention when Cyrus lost the old one", async () => {
		const { coordinator, dispatched, states } = setup();
		await coordinator.handle(assigned());
		states.clear();
		await coordinator.handle(comment("still there?", true));
		expect(dispatched.map((w) => w.action)).toEqual(["created", "created"]);
	});

	it("sends a stop signal for 'stop' while working, and nothing otherwise", async () => {
		const { coordinator, dispatched, states } = setup();
		await coordinator.handle(comment("stop", true));
		expect(dispatched).toHaveLength(0);

		await coordinator.handle(assigned());
		await coordinator.handle(comment("stop", true));
		expect(dispatched[1]!.action).toBe("prompted");
		expect((dispatched[1]!.agentActivity as Activity).signal).toBe("stop");

		states.set((dispatched[0]!.agentSession as Session).id, "idle");
		await coordinator.handle(comment("stop", true));
		expect(dispatched).toHaveLength(2);
	});

	it("resolves a numbered reply to a question's option", async () => {
		const { coordinator, dispatched, directory, states } = setup();
		await coordinator.handle(assigned());
		const id = (dispatched[0]!.agentSession as Session).id;
		directory.update(id, { pendingOptions: ["web-frontend", "api"] });
		states.set(id, "awaiting-input");

		await coordinator.handle(comment("2", false));
		expect((dispatched[1]!.agentActivity as Activity).content.body).toBe("api");
		expect(directory.get(id)?.pendingOptions).toBeUndefined();
	});

	it("turns an unassignment into issueUnassignedFromYou", async () => {
		const { coordinator, dispatched } = setup();
		await coordinator.handle({
			kind: "unassigned",
			eventId: "e-unassign",
			issueId: "t-1",
			actorId: "u-1",
		});
		expect(dispatched[0]).toMatchObject({
			type: "AppUserNotification",
			action: "issueUnassignedFromYou",
			organizationId: "fake-ws",
			notification: { issue: { id: "t-1", identifier: "TCK-1" } },
		});
	});
});
