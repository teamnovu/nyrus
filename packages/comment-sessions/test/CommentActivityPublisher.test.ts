import type { AgentActivityCreateInput } from "cyrus-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CommentActivityPublisher,
	progressMarkdown,
} from "../src/CommentActivityPublisher.js";
import { SessionStore } from "../src/SessionStore.js";
import { fakeTracker } from "./fakeTracker.js";

function setup() {
	const tracker = fakeTracker();
	const store = new SessionStore();
	const publisher = new CommentActivityPublisher(tracker, store, {
		minUpdateMs: 1000,
	});
	const publish = (
		content: Record<string, unknown>,
		extra: Partial<AgentActivityCreateInput> = {},
	) =>
		publisher.publish("t-1", {
			agentSessionId: "fake-t-1",
			content,
			...extra,
		} as AgentActivityCreateInput);
	return { publish, publisher, store, tracker };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("CommentActivityPublisher", () => {
	it("keeps one progress comment and deletes it when the answer is posted", async () => {
		vi.useFakeTimers();
		const { publish, store, tracker } = setup();

		await publish({ type: "thought", body: "Reading the login code" });
		expect(tracker.postComment).toHaveBeenCalledTimes(1);
		expect(tracker.postComment.mock.calls[0]![2]).toEqual({ progress: true });
		const [noteId] = [...tracker.comments.keys()];
		expect(store.isOwnComment(noteId!)).toBe(true);

		// Edits are throttled; the latest thought and the steps since are shown.
		await publish({ type: "action", action: "Bash", parameter: "pnpm test" });
		await publish({ type: "thought", body: "Tests pass" });
		expect(tracker.updateComment).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		expect(tracker.updateComment).toHaveBeenCalledTimes(1);
		expect(tracker.comments.get(noteId!)).toBe(
			progressMarkdown({ latest: "Tests pass", steps: ["Bash: pnpm test"] }),
		);

		const answer = await publish({ type: "response", body: "Fixed in #12." });
		expect(tracker.comments.has(noteId!)).toBe(false);
		expect([...tracker.comments.values()]).toEqual(["Fixed in #12."]);
		expect(store.isOwnComment(answer.id)).toBe(true);
	});

	it("does not show housekeeping thoughts as progress", async () => {
		const { publish, tracker } = setup();
		await publish({ type: "thought", body: "Using model: opus" });
		expect([...tracker.comments.values()]).toEqual([
			progressMarkdown({ steps: [] }),
		]);
	});

	it("retries the progress comment after a failed first post", async () => {
		const { publish, tracker } = setup();
		tracker.postComment.mockRejectedValueOnce(new Error("502"));
		await publish({ type: "thought", body: "Reading" });
		await publish({ type: "thought", body: "Still reading" });
		expect(tracker.postComment).toHaveBeenCalledTimes(2);
		expect(tracker.comments.size).toBe(1);
	});

	it("numbers a question's options and remembers them for the answer", async () => {
		const { publish, store, tracker } = setup();
		const question = await publish(
			{ type: "elicitation", body: "Which repository should I work in?" },
			{
				signalMetadata: {
					options: [{ value: "web" }, { value: "api", label: "API" }],
				},
			} as Partial<AgentActivityCreateInput>,
		);

		expect(tracker.comments.get(question.id)).toBe(
			"Which repository should I work in?\n\n1. `web`\n2. API (`api`)\n\nReply with the number or the name.",
		);
		expect(store.resolveAnswer("fake-t-1", "api")).toBe("api");
	});

	it("posts errors with a warning sign", async () => {
		const { publish, tracker } = setup();
		const error = await publish({ type: "error", body: "Tests failed" });
		expect(tracker.comments.get(error.id)).toBe("⚠️ Tests failed");
	});
});
