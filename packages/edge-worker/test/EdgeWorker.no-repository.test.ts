import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig } from "../src/types.js";

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

describe("EdgeWorker - a ticket no repository takes", () => {
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "nyrus-no-repo-"));
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	function worker() {
		const config: EdgeWorkerConfig = {
			platform: "linear",
			cyrusHome: home,
			repositories: [
				{
					id: "web",
					name: "web",
					repositoryPath: "/repos/web",
					workspaceBaseDir: "/worktrees",
					baseBranch: "main",
					linearWorkspaceId: "github",
					isActive: true,
				},
			],
		};
		const edgeWorker = new EdgeWorker(config);
		const createComment = vi.fn(async () => ({}));
		const internals = edgeWorker as unknown as {
			trackerIntegrations: Array<{ workspaceKey: string }>;
			issueTrackers: Map<string, { createComment: typeof createComment }>;
			logger: { warn: (...args: unknown[]) => void };
			handleAgentSessionCreatedWebhook: (
				webhook: unknown,
				repos: unknown[],
			) => Promise<void>;
		};
		internals.trackerIntegrations = [{ workspaceKey: "jira-novu" }];
		internals.issueTrackers.set("jira-novu", { createComment });
		const warn = vi.spyOn(internals.logger, "warn");
		return { internals, createComment, warn, config };
	}

	const webhook = {
		type: "AgentSessionEvent",
		action: "created",
		organizationId: "jira-novu",
		agentSession: {
			id: "jira-10001",
			issue: {
				id: "10001",
				identifier: "SAY-12",
				title: "Fix the shop",
				team: { id: "SAY", key: "SAY", name: "Sayflowers" },
			},
		},
	};

	it("warns in the log and tells the ticket once, instead of doing nothing", async () => {
		const { internals, createComment, warn, config } = worker();
		await internals.handleAgentSessionCreatedWebhook(
			webhook,
			config.repositories,
		);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				"No repository takes work from workspace jira-novu (project SAY): SAY-12 ignored",
			),
		);
		expect(createComment).toHaveBeenCalledWith("10001", {
			body: expect.stringContaining(
				"Für das Projekt SAY ist kein Repository eingerichtet",
			),
		});
	});

	it("doesn't comment on tickets of trackers without comment sessions (e.g. Linear)", async () => {
		const { internals, createComment, warn, config } = worker();
		internals.trackerIntegrations = [];
		await internals.handleAgentSessionCreatedWebhook(
			{ ...webhook, organizationId: "lin" },
			config.repositories,
		);
		expect(warn).toHaveBeenCalled();
		expect(createComment).not.toHaveBeenCalled();
	});
});
