import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	chatTitle,
	historicalSummary,
	SessionHistory,
	type SessionSummary,
	sessionSource,
	sessionState,
	summarizeSession,
} from "../src/sessionSummary.js";

describe("session summaries", () => {
	it.each([
		[{ id: "uuid-1", issueContext: { trackerId: "linear" } }, "linear"],
		[{ id: "jira-99", issueContext: { trackerId: "linear" } }, "jira"],
		[{ id: "clickup-abc", issueContext: { trackerId: "linear" } }, "clickup"],
		[
			{ id: "gh-issues-123", issueContext: { trackerId: "linear" } },
			"github-issue",
		],
		[
			{ id: "github-delivery", issueContext: { trackerId: "github" } },
			"github-pr",
		],
		[{ id: "gitlab-1700", issueContext: { trackerId: "gitlab" } }, "gitlab"],
		[{ id: "slack-ev-1" }, "slack"],
		[{ id: "zulip-42" }, "zulip"],
		[{ id: "odd" }, "unknown"],
	])("names the source of %o", (session, source) => {
		expect(sessionSource(session)).toBe(source);
	});

	it("takes the edge worker's word for Linear-shaped sessions only", () => {
		const plane = { id: "run-1", issueContext: { trackerId: "linear" } };
		expect(sessionSource(plane, "plane")).toBe("plane");
		expect(
			sessionSource(
				{ id: "jira-1", issueContext: { trackerId: "linear" } },
				"plane",
			),
		).toBe("jira");
		expect(sessionSource({ id: "slack-1" }, "cli")).toBe("slack");
	});

	it("groups statuses", () => {
		expect(
			["active", "pending", "awaitingInput", "complete", "error", "stale"].map(
				sessionState,
			),
		).toEqual(["running", "waiting", "waiting", "finished", "failed", "stale"]);
	});

	it("summarizes runner, title and parent", () => {
		const summary = summarizeSession(
			{
				id: "slack-1",
				status: "complete",
				codexSessionId: "c1",
				metadata: { title: "Deploy status?" },
			},
			[],
			{ parentSessionId: "parent-1" },
		);
		expect(summary).toMatchObject({
			source: "slack",
			runner: "codex",
			title: "Deploy status?",
			state: "finished",
			parentSessionId: "parent-1",
			live: true,
		});
	});

	it("shortens chat titles to one line", () => {
		expect(chatTitle("  hello\n  world ")).toBe("hello world");
		expect(chatTitle("x".repeat(300))).toHaveLength(140);
	});

	it("marks a dropped unfinished session as interrupted", () => {
		const running = summarizeSession({ id: "s", status: "active" }, []);
		expect(historicalSummary(running)).toMatchObject({
			status: "stale",
			state: "stale",
			live: false,
		});
		const done = summarizeSession({ id: "s", status: "error" }, []);
		expect(historicalSummary(done)).toMatchObject({
			status: "error",
			state: "failed",
			live: false,
		});
	});
});

describe("SessionHistory", () => {
	let dir: string;
	let path: string;
	const now = 100 * 24 * 60 * 60 * 1000;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "nyrus-history-"));
		path = join(dir, "state", "session-history.json");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function summary(id: string, updatedAt: number): SessionSummary {
		return summarizeSession({ id, status: "complete", updatedAt }, []);
	}

	it("persists records and reads them back", () => {
		const history = new SessionHistory(path, { now: () => now });
		history.record(summary("a", now - 10));
		history.save();
		expect(new SessionHistory(path, { now: () => now }).get("a")).toMatchObject(
			{
				id: "a",
			},
		);
		expect(SessionHistory.read(path).map((s) => s.id)).toEqual(["a"]);
	});

	it("keeps at most the newest N within the age limit", () => {
		const history = new SessionHistory(path, {
			now: () => now,
			maxEntries: 2,
			maxAgeMs: 1000,
		});
		history.record(summary("old", now - 5000));
		history.record(summary("a", now - 30));
		history.record(summary("b", now - 20));
		history.record(summary("c", now - 10));
		expect(history.list().map((s) => s.id)).toEqual(["c", "b"]);
		history.save();
		expect(SessionHistory.read(path).map((s) => s.id)).toEqual(["c", "b"]);
	});

	it("knows when a record is current and skips unchanged writes", () => {
		const history = new SessionHistory(path, { now: () => now });
		history.record(summary("a", now));
		expect(history.isCurrent("a", now, "complete", 0)).toBe(true);
		expect(history.isCurrent("a", now, "error", 0)).toBe(false);
		expect(history.isCurrent("a", now, "complete", 3)).toBe(false);
		history.save();
		const written = readFileSync(path, "utf-8");
		history.record(summary("a", now));
		history.save();
		expect(readFileSync(path, "utf-8")).toBe(written);
	});

	it("treats a missing or broken file as empty", () => {
		expect(SessionHistory.read(join(dir, "missing.json"))).toEqual([]);
		const broken = join(dir, "broken.json");
		writeFileSync(broken, "{");
		expect(SessionHistory.read(broken)).toEqual([]);
	});
});
