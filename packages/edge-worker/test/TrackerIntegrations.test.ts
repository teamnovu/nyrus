import type { TrackerIntegrationFactory } from "cyrus-comment-sessions";
import { createGitHubIssuesIntegration } from "cyrus-comment-sessions";
import { describe, expect, it, vi } from "vitest";
import { createTrackerIntegrations } from "../src/TrackerIntegrations.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;

describe("createTrackerIntegrations", () => {
	it("works GitHub issues with only GITHUB_WEBHOOK_SECRET, without mirroring tickets into GitHub issues", () => {
		const jira = vi.fn(((context) => {
			expect(context.githubIssues).toBeUndefined();
			return null;
		}) as TrackerIntegrationFactory);
		const integrations = createTrackerIntegrations(
			{ env: { GITHUB_WEBHOOK_SECRET: "s" }, cyrusHome: "/tmp/unused", logger },
			[jira, createGitHubIssuesIntegration],
		);
		expect(jira).toHaveBeenCalledOnce();
		expect(integrations.map((i) => i.workspaceKey)).toEqual(["github"]);
		expect(integrations[0]!.handleGitHubEvent).toBeTypeOf("function");
	});

	it("leaves GitHub issues off without any GitHub webhook secret", () => {
		expect(
			createTrackerIntegrations({ env: {}, cyrusHome: "/tmp/unused", logger }, [
				createGitHubIssuesIntegration,
			]),
		).toEqual([]);
	});

	it("shares one GitHubIssueThreads between mirroring trackers and GitHub issues with GITHUB_ISSUES_WEBHOOK_SECRET", () => {
		let seen: unknown;
		const jira = ((context) => {
			seen = context.githubIssues;
			return null;
		}) as TrackerIntegrationFactory;
		const integrations = createTrackerIntegrations(
			{
				env: { GITHUB_ISSUES_WEBHOOK_SECRET: "s" },
				cyrusHome: "/tmp/unused",
				logger,
			},
			[jira, createGitHubIssuesIntegration],
		);
		expect(seen).toBeDefined();
		expect(integrations).toHaveLength(1);
	});
});
