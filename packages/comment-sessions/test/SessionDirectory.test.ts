import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionDirectory } from "../src/SessionDirectory.js";

const dirs: string[] = [];
function tempFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "comment-sessions-"));
	dirs.push(dir);
	return join(dir, "nested", "sessions.json");
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("SessionDirectory", () => {
	it("finds a ticket's latest session", () => {
		let now = 1000;
		const directory = new SessionDirectory("fake", undefined, () => now);
		directory.create("t-1");
		now = 2000;
		const latest = directory.create("t-1", "cm-1");
		directory.create("t-2");

		expect(directory.latestForIssue("t-1")).toEqual(latest);
		expect(directory.latestForIssue("t-3")).toBeUndefined();
	});

	it("keeps sessions across restarts and drops old ones", () => {
		const file = tempFile();
		let now = 0;
		const first = new SessionDirectory("fake", file, () => now);
		first.create("t-old");
		now = 100 * 24 * 60 * 60 * 1000;
		const record = first.create("t-1");
		first.update(record.sessionId, { progressCommentId: "c-1" });
		expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(2);

		const second = new SessionDirectory("fake", file, () => now);
		expect(second.get(record.sessionId)?.progressCommentId).toBe("c-1");
		expect(second.latestForIssue("t-old")).toBeUndefined();
	});

	it("removes fields updated to undefined", () => {
		const directory = new SessionDirectory("fake");
		const record = directory.create("t-1");
		directory.update(record.sessionId, { pendingOptions: ["a"] });
		directory.update(record.sessionId, { pendingOptions: undefined });
		expect(directory.get(record.sessionId)).not.toHaveProperty(
			"pendingOptions",
		);
	});
});
