import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/handlers/repository.js", () => ({
	handleRepository: vi.fn(),
	handleRepositoryDelete: vi.fn(),
}));

import {
	handleDashboardAddRepository,
	handleDashboardConfig,
	handleDashboardEnv,
	handleDashboardRemoveRepository,
	handleDashboardRepositoryRouting,
	handleDashboardSession,
	handleDashboardSessions,
} from "../../src/handlers/dashboard.js";
import {
	handleRepository,
	handleRepositoryDelete,
} from "../../src/handlers/repository.js";

describe("dashboard handlers", () => {
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "nyrus-dashboard-"));
		vi.mocked(handleRepository).mockResolvedValue({
			success: true,
			message: "Repository cloned successfully",
			data: { action: "cloned" },
		});
		vi.mocked(handleRepositoryDelete).mockResolvedValue({
			success: true,
			message: "deleted",
		});
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	function writeState(state: unknown) {
		mkdirSync(join(home, "state"), { recursive: true });
		writeFileSync(
			join(home, "state", "edge-worker-state.json"),
			JSON.stringify({ version: "4.1", savedAt: "now", state }),
		);
	}

	function writeConfig(config: unknown) {
		writeFileSync(join(home, "config.json"), JSON.stringify(config));
	}

	function readConfig() {
		return JSON.parse(readFileSync(join(home, "config.json"), "utf-8"));
	}

	describe("sessions", () => {
		const state = {
			agentSessions: {
				old: {
					id: "old",
					status: "complete",
					createdAt: 1,
					updatedAt: 10,
					issue: { id: "i1", identifier: "WEB-1", title: "Old task" },
					repositories: [{ repositoryId: "web", branchName: "web-1" }],
					workspace: { path: "/w/web-1" },
					metadata: { model: "opus", totalCostUsd: 0.5 },
				},
				new: {
					id: "new",
					status: "active",
					createdAt: 20,
					updatedAt: 30,
					issueContext: {
						trackerId: "clickup",
						issueId: "c1",
						issueIdentifier: "CU-42",
					},
					repositories: [],
					workspace: { path: "/w/cu-42" },
				},
			},
			agentSessionEntries: {
				old: [
					{
						type: "assistant",
						content:
							"Opened https://github.com/teamnovu/web/pull/7 and later https://github.com/teamnovu/web/pull/8",
						metadata: { timestamp: 5 },
					},
					{
						type: "user",
						content: { tool: "Bash", output: "x".repeat(5000) },
						metadata: { timestamp: 9, toolName: "Bash", isError: true },
					},
				],
			},
		};

		it("returns an empty list when nyrus has no state yet", async () => {
			const result = await handleDashboardSessions(home);
			expect(result).toMatchObject({ success: true, data: { sessions: [] } });
		});

		it("lists sessions newest first with issue, PR link and activity", async () => {
			writeState(state);
			const result = await handleDashboardSessions(home);
			expect(result.success).toBe(true);
			const sessions = (result as any).data.sessions;
			expect(sessions.map((s: any) => s.id)).toEqual(["new", "old"]);
			expect(sessions[0]).toMatchObject({
				tracker: "clickup",
				issue: { id: "c1", identifier: "CU-42" },
				entryCount: 0,
				pullRequestUrl: null,
			});
			expect(sessions[1]).toMatchObject({
				status: "complete",
				issue: { identifier: "WEB-1", title: "Old task" },
				repositories: [{ id: "web", branch: "web-1" }],
				model: "opus",
				totalCostUsd: 0.5,
				entryCount: 2,
				lastActivityAt: 9,
				pullRequestUrl: "https://github.com/teamnovu/web/pull/8",
			});
		});

		it("returns one session with truncated entries", async () => {
			writeState(state);
			const result = await handleDashboardSession({ id: "old" }, home);
			expect(result.success).toBe(true);
			const entries = (result as any).data.entries;
			expect(entries).toHaveLength(2);
			expect(entries[1]).toMatchObject({
				type: "user",
				toolName: "Bash",
				isError: true,
				timestamp: 9,
			});
			expect(entries[1].content.length).toBe(4001);
		});

		it("reads live state, names Jira sessions and adds runtime and tokens", async () => {
			vi.useFakeTimers();
			vi.setSystemTime(100_000);
			try {
				const live = {
					agentSessions: {
						"jira-99176": {
							id: "jira-99176",
							status: "active",
							createdAt: 1_000,
							updatedAt: 2_000,
							issueContext: {
								trackerId: "linear",
								issueId: "99176",
								issueIdentifier: "SAY-686",
							},
							metadata: {
								model: "claude-opus",
								runStartedAt: 70_000,
								totals: {
									runs: 1,
									durationMs: 60_000,
									inputTokens: 10,
									outputTokens: 20,
									cacheReadTokens: 300,
									cacheCreationTokens: 4_000,
									costUsd: 1.25,
								},
							},
						},
					},
				};
				// No state file: the live state is what counts
				const result = await handleDashboardSession(
					{ id: "jira-99176" },
					home,
					() => live,
				);
				expect((result as any).data.session).toMatchObject({
					tracker: "jira",
					model: "claude-opus",
					totalCostUsd: 1.25,
					runs: 1,
					// 60 s finished + 30 s of the run in progress
					runtimeMs: 90_000,
					tokens: {
						input: 10,
						output: 20,
						cacheRead: 300,
						cacheCreation: 4_000,
						total: 4_330,
					},
				});
			} finally {
				vi.useRealTimers();
			}
		});

		it("has no runtime or tokens before a session's first run", async () => {
			writeState(state);
			const sessions = ((await handleDashboardSessions(home)) as any).data
				.sessions;
			expect(sessions[0]).toMatchObject({
				tracker: "clickup",
				runtimeMs: null,
				runs: 0,
				tokens: null,
			});
		});

		it("rejects a missing or unknown session id", async () => {
			writeState(state);
			expect((await handleDashboardSession({}, home)).success).toBe(false);
			expect((await handleDashboardSession({ id: "nope" }, home)).success).toBe(
				false,
			);
		});
	});

	describe("config and env", () => {
		it("returns repositories without tokens", async () => {
			writeConfig({
				claudeDefaultModel: "opus",
				repositories: [
					{
						id: "web",
						name: "web",
						linearToken: "secret",
						linearRefreshToken: "secret2",
						projectKeys: ["Web"],
					},
				],
			});
			const result = await handleDashboardConfig(home);
			expect(result).toMatchObject({
				success: true,
				data: {
					repositories: [{ id: "web", projectKeys: ["Web"] }],
					settingKeys: ["claudeDefaultModel"],
				},
			});
			expect(JSON.stringify(result)).not.toContain("secret");
		});

		it("lists .env keys without values", async () => {
			writeFileSync(
				join(home, ".env"),
				"# comment\nCYRUS_SERVER_PORT=3456\nANTHROPIC_API_KEY=sk-secret\nGITHUB_TOKEN=\n",
			);
			const result = await handleDashboardEnv(home);
			expect(result).toMatchObject({
				success: true,
				data: {
					exists: true,
					keys: [
						{ key: "CYRUS_SERVER_PORT", hasValue: true },
						{ key: "ANTHROPIC_API_KEY", hasValue: true },
						{ key: "GITHUB_TOKEN", hasValue: false },
					],
				},
			});
			expect(JSON.stringify(result)).not.toContain("sk-secret");
		});

		it("reports a missing .env", async () => {
			expect(await handleDashboardEnv(home)).toMatchObject({
				success: true,
				data: { exists: false, keys: [] },
			});
		});
	});

	describe("repositories", () => {
		it("clones and adds a repository with defaults and routing", async () => {
			writeConfig({ claudeDefaultModel: "opus", repositories: [] });
			const result = await handleDashboardAddRepository(
				{
					repository_url: "https://github.com/teamnovu/web.git",
					projectKeys: ["Web App", " "],
					routingLabels: ["web"],
				},
				home,
			);
			expect(result.success).toBe(true);
			expect(handleRepository).toHaveBeenCalledWith(
				{
					repository_url: "https://github.com/teamnovu/web.git",
					repository_name: "web",
				},
				home,
			);
			const config = readConfig();
			expect(config.claudeDefaultModel).toBe("opus");
			expect(config.repositories).toEqual([
				{
					id: "web",
					name: "web",
					repositoryPath: join(home, "repos", "web"),
					baseBranch: "main",
					githubUrl: "https://github.com/teamnovu/web",
					workspaceBaseDir: join(home, "worktrees"),
					isActive: true,
					teamKeys: [],
					projectKeys: ["Web App"],
					routingLabels: ["web"],
				},
			]);
		});

		it("does not touch the config when cloning fails", async () => {
			writeConfig({ repositories: [] });
			vi.mocked(handleRepository).mockResolvedValue({
				success: false,
				error: "Failed to clone repository",
			});
			const result = await handleDashboardAddRepository(
				{ repository_url: "https://github.com/teamnovu/web.git" },
				home,
			);
			expect(result.success).toBe(false);
			expect(readConfig().repositories).toEqual([]);
		});

		it("rejects names that could escape the repos directory", async () => {
			const result = await handleDashboardAddRepository(
				{ repository_url: "https://example.com/x.git", name: "../evil" },
				home,
			);
			expect(result.success).toBe(false);
			expect(handleRepository).not.toHaveBeenCalled();
		});

		it("updates routing and keeps tokens and other fields", async () => {
			writeConfig({
				repositories: [
					{
						id: "web",
						name: "web",
						baseBranch: "main",
						linearToken: "secret",
						teamKeys: ["OLD"],
					},
				],
			});
			const result = await handleDashboardRepositoryRouting(
				{
					name: "web",
					baseBranch: "develop",
					teamKeys: ["WEB"],
					isActive: false,
				},
				home,
			);
			expect(result.success).toBe(true);
			expect(readConfig().repositories[0]).toEqual({
				id: "web",
				name: "web",
				baseBranch: "develop",
				linearToken: "secret",
				teamKeys: ["WEB"],
				isActive: false,
			});
			expect(JSON.stringify(result)).not.toContain("secret");
		});

		it("rejects routing for an unknown repository", async () => {
			writeConfig({ repositories: [] });
			const result = await handleDashboardRepositoryRouting(
				{ name: "nope" },
				home,
			);
			expect(result.success).toBe(false);
		});

		it("removes a repository and only deletes files when asked", async () => {
			writeConfig({
				repositories: [
					{ id: "web", name: "web" },
					{ id: "api", name: "api" },
				],
			});
			const kept = await handleDashboardRemoveRepository({ name: "web" }, home);
			expect(kept.success).toBe(true);
			expect(handleRepositoryDelete).not.toHaveBeenCalled();
			expect(readConfig().repositories).toEqual([{ id: "api", name: "api" }]);

			const deleted = await handleDashboardRemoveRepository(
				{ name: "api", deleteFiles: true },
				home,
			);
			expect(deleted.success).toBe(true);
			expect(handleRepositoryDelete).toHaveBeenCalledWith(
				{ repository_name: "api", linear_team_key: "" },
				home,
			);
			expect(readConfig().repositories).toEqual([]);
		});
	});
});
