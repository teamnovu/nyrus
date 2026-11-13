import { createClickUpIntegration } from "cyrus-clickup-event-transport";
import type {
	TrackerIntegration,
	TrackerIntegrationFactory,
} from "cyrus-comment-sessions";
import type { ILogger } from "cyrus-core";
import { createJiraIntegration } from "cyrus-jira-event-transport";

/**
 * Trackers without built-in agent sessions (ClickUp, Jira), built on
 * cyrus-comment-sessions. Each factory returns null unless its environment
 * variables are set. Add a tracker by appending its factory here.
 */
export const trackerIntegrationFactories: TrackerIntegrationFactory[] = [
	createJiraIntegration,
	createClickUpIntegration,
];

/** Build every configured tracker integration; one failing doesn't stop the others. */
export function createTrackerIntegrations(
	context: Parameters<TrackerIntegrationFactory>[0],
	factories: TrackerIntegrationFactory[] = trackerIntegrationFactories,
): TrackerIntegration[] {
	const integrations: TrackerIntegration[] = [];
	for (const factory of factories) {
		try {
			const integration = factory(context);
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
