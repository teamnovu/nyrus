import { createClickUpIntegration } from "cyrus-clickup-event-transport";
import {
	createGitHubIssuesIntegration,
	createGitHubIssueThreadsFromEnv,
	type TrackerIntegration,
	type TrackerIntegrationFactory,
} from "cyrus-comment-sessions";
import type { ILogger } from "cyrus-core";
import { createInbudgetIntegration } from "cyrus-inbudget-sync";
import { createJiraIntegration } from "cyrus-jira-event-transport";
import { createServicedeskTriageIntegration } from "cyrus-servicedesk-triage";

/**
 * Trackers without built-in agent sessions (ClickUp, Jira, GitHub issues
 * worked directly), built on cyrus-comment-sessions. Each factory returns null unless its environment
 * variables are set. Add a tracker by appending its factory here.
 */
export const trackerIntegrationFactories: TrackerIntegrationFactory[] = [
	createJiraIntegration,
	createClickUpIntegration,
	// GitHub issues as tickets (needs GITHUB_ISSUES_WEBHOOK_SECRET).
	createGitHubIssuesIntegration,
	// Not a tracker: repositories and their routing from inBudget projects.
	createInbudgetIntegration,
	// Not a tracker: suggests project and assignee for new service desk tickets.
	createServicedeskTriageIntegration,
];

/**
 * Build every configured tracker integration; one failing doesn't stop the
 * others. With GITHUB_ISSUES_WEBHOOK_SECRET set, their tickets are worked in
 * GitHub issues (one shared GitHubIssueThreads for all of them).
 */
export function createTrackerIntegrations(
	context: Parameters<TrackerIntegrationFactory>[0],
	factories: TrackerIntegrationFactory[] = trackerIntegrationFactories,
): TrackerIntegration[] {
	const integrations: TrackerIntegration[] = [];
	let githubIssues = context.githubIssues;
	if (!githubIssues) {
		try {
			githubIssues = createGitHubIssueThreadsFromEnv(context);
		} catch (error) {
			context.logger.error(
				"Working tickets in GitHub issues is misconfigured and stays off",
				error,
			);
		}
	}
	for (const factory of factories) {
		try {
			const integration = factory({ ...context, githubIssues });
			if (integration) integrations.push(integration);
		} catch (error) {
			logFactoryError(context.logger, factory, error);
		}
	}
	return integrations;
}

function logFactoryError(
	logger: ILogger,
	factory: TrackerIntegrationFactory,
	error: unknown,
): void {
	logger.error(
		`Tracker integration ${factory.name || "(anonymous)"} is misconfigured and was not started`,
		error,
	);
}
