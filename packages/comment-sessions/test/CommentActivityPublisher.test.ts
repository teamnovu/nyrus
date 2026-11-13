import type { AgentActivityCreateInput } from "cyrus-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentActivityPublisher } from "../src/CommentActivityPublisher.js";
import { SessionDirectory } from "../src/SessionDirectory.js";
import { fakeTracker } from "./fakeTracker.js";

function setup() {
	const tracker = fakeTracker();
	const directory = new SessionDirectory("fake");
	const session = directory.create("t-1");
	const publisher = new CommentActivityPublisher(tracker, directory, {
		minUpdateMs: 1000,
	});
	const publish = (
		content: Record<string, unknown>,
		extra: Partial<AgentActivityCreateInput> = {},
	) =>
		publisher.publish({
			agentSessionId: session.sessionId,
			content,
			...extra,
		} as AgentActivityCreateInput);
	return { directory, publish, publisher, session, tracker };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("CommentActivityPublisher", () => {
	it("keeps one progress comment and deletes it when the answer is posted", async () => {
		vi.useFakeTimers();
		const { directory, publish, session, tracker } = setup();

		await publish({ type: "thought", body: "Reading the login code" });
		expect(tracker.postComment).toHaveBeenCalledTimes(1);
		const [progressId] = [...tracker.comments.keys()];
		expect(tracker.comments.get(progressId!)).toContain(
			"Now: Reading the login code",
		);
		expect(directory.get(session.sessionId)?.progressCommentId).toBe(
			progressId,
		);

		// Edits are throttled to the latest step.
		await publish({ type: "action", action: "Bash", parameter: "pnpm test" });
		await publish({ type: "thought", body: "Tests pass" });
		expect(tracker.updateComment).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		expect(tracker.updateComment).toHaveBeenCalledTimes(1);
		expect(tracker.comments.get(progressId!)).toContain("Now: Tests pass");

		const answer = await publish({ type: "response", body: "Fixed in #12." });
		expect(tracker.comments.has(progressId!)).toBe(false);
		expect(tracker.comments.get(answer.id)).toBe("Fixed in #12.");
		expect(tracker.comments.size).toBe(1);
		expect(directory.get(session.sessionId)?.progressCommentId).toBeUndefined();
	});

	it("does not show housekeeping thoughts as progress", async () => {
		const { publish, tracker } = setup();
		await publish({ type: "thought", body: "Using model: opus" });
		const [note] = [...tracker.comments.values()];
		expect(note).not.toContain("Now:");
	});

	it("numbers a question's options and remembers them", async () => {
		const { directory, publish, session, tracker } = setup();
		const question = await publish(
			{ type: "elicitation", body: "Which repository should I work in?" },
			{
				signalMetadata: {
					options: [{ value: "web-frontend" }, { value: "api", label: "API" }],
				},
			} as Partial<AgentActivityCreateInput>,
		);

		expect(tracker.comments.get(question.id)).toBe(
			"Which repository should I work in?\n\n1. web-frontend\n2. API\n\nReply with the number or the name.",
		);
		expect(directory.get(session.sessionId)?.pendingOptions).toEqual([
			"web-frontend",
			"api",
		]);
	});

	it("posts errors with a warning sign", async () => {
		const { publish, tracker } = setup();
		const error = await publish({ type: "error", body: "Tests failed" });
		expect(tracker.comments.get(error.id)).toBe("⚠️ Tests failed");
	});

	it("deletes a progress comment left over from before a restart", async () => {
		const { directory, publish, session, tracker } = setup();
		directory.update(session.sessionId, { progressCommentId: "old-note" });
		tracker.comments.set("old-note", "⏳ Working on it.");

		await publish({ type: "response", body: "Done." });
		expect(tracker.deleteComment).toHaveBeenCalledWith("t-1", "old-note");
		expect(tracker.comments.has("old-note")).toBe(false);
	});

	it("drops activities of unknown sessions", async () => {
		const { publisher, tracker } = setup();
		const result = await publisher.publish({
			agentSessionId: "nope",
			content: { type: "response", body: "hi" },
		} as AgentActivityCreateInput);
		expect(result.id).toBe("");
		expect(tracker.postComment).not.toHaveBeenCalled();
	});
});
