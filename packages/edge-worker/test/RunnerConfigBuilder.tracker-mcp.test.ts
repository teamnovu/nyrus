import type { TrackerMcpSession } from "cyrus-comment-sessions";
import type { CyrusAgentSession, ILogger, RepositoryConfig } from "cyrus-core";
import { describe, expect, it } from "vitest";
import {
	RunnerConfigBuilder,
	trackerMcpSession,
} from "../src/RunnerConfigBuilder.js";

const session = {
	issueId: "issue-1",
	issue: { identifier: "SAY-12" },
	workspace: { path: "/home/forge/.cyrus/worktrees/sayflowers/SAY-12" },
} as unknown as CyrusAgentSession;

const attachmentsDir = "/home/forge/.cyrus/SAY-12/attachments";

describe("trackerMcpSession", () => {
	it("gives the tracker tools the worktree and the readable attachments folder", () => {
		expect(
			trackerMcpSession({
				session,
				cyrusHome: "/home/forge/.cyrus",
				allowedDirectories: [attachmentsDir, "/home/forge/.cyrus/repos/x"],
			}),
		).toEqual({ workspacePath: session.workspace.path, attachmentsDir });
	});

	it("leaves out an attachments folder the session can't read", () => {
		expect(
			trackerMcpSession({
				session,
				cyrusHome: "/home/forge/.cyrus",
				allowedDirectories: ["/home/forge/.cyrus/repos/x"],
			}),
		).toEqual({ workspacePath: session.workspace.path });
	});

	it("is passed on when the issue session's MCP servers are built", () => {
		const seen: Array<TrackerMcpSession | undefined> = [];
		const builder = new RunnerConfigBuilder(
			{ buildChatAllowedTools: () => [] },
			{
				buildMcpConfig: (_repo, _workspace, _parent, trackerSession) => {
					seen.push(trackerSession);
					return {};
				},
				buildMergedMcpConfigPath: () => undefined,
			},
			{
				determineRunnerSelection: () => ({ runnerType: "claude" }),
				getDefaultModelForRunner: () => "model",
				getDefaultFallbackModelForRunner: () => "fallback",
			},
		);

		builder.buildIssueConfig({
			session,
			repository: {
				id: "repo-a",
				name: "Repo A",
				repositoryPath: "/home/forge/.cyrus/repos/sayflowers",
			} as unknown as RepositoryConfig,
			sessionId: "sess-1",
			systemPrompt: "test",
			allowedTools: [],
			allowedDirectories: [attachmentsDir],
			disallowedTools: [],
			cyrusHome: "/home/forge/.cyrus",
			linearWorkspaceId: "jira-novu",
			logger: {
				debug: () => {},
				info: () => {},
				warn: () => {},
				error: () => {},
			} as unknown as ILogger,
			onMessage: () => {},
			onError: () => {},
			requireLinearWorkspaceId: () => "jira-novu",
		});

		expect(seen).toEqual([
			{ workspacePath: session.workspace.path, attachmentsDir },
		]);
	});
});
