import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	handleDashboardSession,
	handleDashboardSessions,
} from "cyrus-config-updater";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

vi.mock("cyrus-claude-runner");
vi.mock("cyrus-codex-runner");
vi.mock("cyrus-gemini-runner");
vi.mock("cyrus-linear-event-transport");
vi.mock("@linear/sdk");
vi.mock("file-type");
vi.mock("chokidar", () => ({
	watch: vi.fn().mockReturnValue({
		on: vi.fn().mockReturnThis(),
		close: vi.fn().mockResolvedValue(undefined),
	}),
}));

const repository = (
	id: string,
	linearWorkspaceId: string,
): RepositoryConfig => ({
	id,
	name: id,
	repositoryPath: `/repos/${id}`,
	workspaceBaseDir: "/worktrees",
	baseBranch: "main",
	linearWorkspaceId,
	isActive: true,
});

describe("EdgeWorker - dashboard sessions", () => {
	let home: string;
	let config: EdgeWorkerConfig;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "nyrus-dashboard-sessions-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		config = {
			platform: "linear",
			cyrusHome: home,
			repositories: [repository("web", "lin"), repository("app", "plane-acme")],
			linearWorkspaces: { lin: { linearToken: "t" } },
		};
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	function issue(id: string, identifier: string) {
		return { id, identifier, title: `Task ${identifier}`, branchName: id };
	}

	function addSessions(worker: EdgeWorker) {
		const asm = (worker as any).agentSessionManager;
		const workspace = { path: "/worktrees/x", isGitWorktree: true };
		asm.createCyrusAgentSession(
			"lin-1",
			"i1",
			issue("i1", "WEB-1"),
			workspace,
			"linear",
			[{ repositoryId: "web" }],
		);
		asm.createCyrusAgentSession(
			"run-7",
			"p7",
			issue("p7", "ACME-7"),
			workspace,
			"linear",
			[{ repositoryId: "app" }],
		);
		asm.createCyrusAgentSession(
			"github-delivery-1",
			"pr-1",
			issue("pr-1", "web#12"),
			workspace,
			"github",
			[{ repositoryId: "web" }],
		);
		asm.getSession("lin-1").claudeSessionId = "claude-abc";
	}

	/** A Slack handler as EdgeWorker sees it: its own sessions and entries. */
	function fakeSlackHandler() {
		const session = {
			id: "slack-ev-1",
			type: "commentThread",
			status: "active",
			context: "commentThread",
			createdAt: Date.now() - 1000,
			updatedAt: Date.now(),
			repositories: [],
			workspace: { path: "/slack/thread", isGitWorktree: false },
			metadata: { title: "Why does the build fail?" },
		};
		return {
			getAllChatSessions: () => [session],
			serializeChatState: () => ({
				sessions: { [session.id]: session },
				entries: {
					[session.id]: [
						{
							type: "assistant",
							content: "Looking",
							metadata: { timestamp: 7 },
						},
					],
				},
			}),
		};
	}

	it("lists issue, PR, Plane and chat sessions with their source", async () => {
		const worker = new EdgeWorker(config);
		addSessions(worker);
		(worker as any).chatSessionHandler = fakeSlackHandler();

		const result = await handleDashboardSessions(home, () =>
			worker.dashboardState(),
		);
		const sessions = (result as any).data.sessions as any[];
		const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));

		expect(Object.keys(byId).sort()).toEqual([
			"github-delivery-1",
			"lin-1",
			"run-7",
			"slack-ev-1",
		]);
		expect(byId["lin-1"]).toMatchObject({
			source: "linear",
			runner: "claude",
			state: "running",
			live: true,
		});
		expect(byId["run-7"]).toMatchObject({ source: "plane" });
		expect(byId["github-delivery-1"]).toMatchObject({
			source: "github-pr",
			issue: { identifier: "web#12" },
		});
		expect(byId["slack-ev-1"]).toMatchObject({
			source: "slack",
			title: "Why does the build fail?",
			entryCount: 1,
			live: true,
		});

		// The chat session's activity log is readable too
		const detail = await handleDashboardSession(
			{ id: "slack-ev-1" },
			home,
			() => worker.dashboardState(),
		);
		expect((detail as any).data.entries).toHaveLength(1);
	});

	it("keeps listing sessions after a restart and after they were removed", async () => {
		const worker = new EdgeWorker(config);
		addSessions(worker);
		(worker as any).chatSessionHandler = fakeSlackHandler();
		worker.dashboardState();

		// A closed ticket removes its session; the history keeps it as finished
		const asm = (worker as any).agentSessionManager;
		(worker as any).recordSessionHistory(asm.getSession("lin-1"), "complete");
		asm.removeSession("lin-1");

		// A new process holds neither the chat session nor the removed one
		const restarted = new EdgeWorker(config);
		const result = await handleDashboardSessions(home, () =>
			restarted.dashboardState(),
		);
		const byId = Object.fromEntries(
			((result as any).data.sessions as any[]).map((s) => [s.id, s]),
		);
		expect(byId["slack-ev-1"]).toMatchObject({
			source: "slack",
			status: "stale",
			state: "stale",
			live: false,
		});
		expect(byId["lin-1"]).toMatchObject({
			status: "complete",
			state: "finished",
			live: false,
		});

		// The detail degrades to the summary, without entries
		const detail = await handleDashboardSession({ id: "lin-1" }, home, () =>
			restarted.dashboardState(),
		);
		expect(detail).toMatchObject({
			success: true,
			data: { session: { id: "lin-1", live: false }, entries: [] },
		});
	});
});
