import { describe, expect, it } from "vitest";
import { JiraProgressNotes } from "../src/JiraProgressNotes.js";
import { fakeJira } from "./fakeJira.js";

const note = { id: "note-1", created: "", updated: "" };
const down = async () => new Response("down", { status: 503 });

/** Let a fire-and-forget request settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("JiraProgressNotes", () => {
	it("posts the note at a later step when the first attempt failed", async () => {
		const { api, calls, fetchImpl } = fakeJira({
			"POST /issue/10001/comment": note,
		});
		fetchImpl.mockImplementationOnce(down);
		const notes = new JiraProgressNotes(api, { minUpdateMs: 0 });

		await notes.onStep("10001", { thought: "Reading the issue" });
		await notes.onStep("10001", { thought: "Looking at Header.vue" });

		const posts = calls.filter((c) => c.method === "POST");
		expect(posts).toHaveLength(1);
		expect((posts[0]!.body as { body: string }).body).toContain(
			"Looking at Header.vue",
		);
	});

	it("tries an edit again when Jira didn't save it", async () => {
		const { api, calls, fetchImpl } = fakeJira({
			"POST /issue/10001/comment": note,
			"PUT /issue/10001/comment/note-1": note,
		});
		const notes = new JiraProgressNotes(api, { minUpdateMs: 0 });
		await notes.onStep("10001", { thought: "Reading the issue" });

		fetchImpl.mockImplementationOnce(down);
		await notes.onStep("10001", { thought: "Running the tests" });
		await settle();
		await notes.onStep("10001", { thought: "Running the tests" });
		await settle();

		const edits = calls.filter((c) => c.method === "PUT");
		expect(edits).toHaveLength(1);
		expect((edits[0]!.body as { body: string }).body).toContain(
			"Running the tests",
		);
	});
});
