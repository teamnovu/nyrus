import type {
	AgentRunSummary,
	CommentSessionCoordinator,
	CommentTrackerEvent,
	DispatchTiming,
	TrackerIntegration,
	TrackerIntegrationFactory,
} from "cyrus-comment-sessions";
import type { ILogger } from "cyrus-core";
import { JiraApiClient } from "./JiraApiClient.js";
import { JiraEventTransport } from "./JiraEventTransport.js";
import { JiraIssueTrackerService } from "./JiraIssueTrackerService.js";
import { isSigned, mentionsAgent, promptFromComment } from "./JiraText.js";
import type {
	JiraChangelogItem,
	JiraTriggerOptions,
	JiraUser,
	JiraWebhookEvent,
} from "./types.js";

/**
 * A Jira webhook as a cyrus-comment-sessions event. Jira-specific: the
 * comment's wiki markup and mention, and whether the issue's changelog shows
 * the hand-over (label or assignee) changing.
 */
export function toCommentTrackerEvent(
	event: JiraWebhookEvent,
	agent: JiraUser,
	options: JiraTriggerOptions,
): CommentTrackerEvent {
	const { comment } = event;
	if (event.kind === "comment" && comment) {
		return {
			kind: "comment",
			// A comment is posted once; a second delivery of it is a retry.
			eventId: `jira:comment:${comment.id}`,
			issueId: event.issueKey,
			commentId: comment.id,
			body: promptFromComment(comment.body, agent.accountId),
			mentionsAgent: mentionsAgent(comment.body, agent.accountId),
			own: isSigned(comment.body),
			actor: comment.authorAccountId
				? {
						id: comment.authorAccountId,
						name: comment.authorName,
						email:
							event.actor?.accountId === comment.authorAccountId
								? event.actor.emailAddress
								: undefined,
					}
				: toActor(event.actor),
		};
	}
	return {
		kind: "issue",
		issueId: event.issueKey,
		handOver: handOverChange(event, agent, options),
		actor: toActor(event.actor),
	};
}

function toActor(user: JiraUser | undefined) {
	return user
		? { id: user.accountId, name: user.displayName, email: user.emailAddress }
		: undefined;
}

/**
 * What happens to a verified Jira webhook: Cyrus's own comments are dropped
 * without asking Jira, the rest go to the session coordinator.
 */
export function jiraEventHandler(
	tracker: JiraIssueTrackerService,
	coordinator: Pick<CommentSessionCoordinator, "handle">,
	logger: ILogger,
): (event: JiraWebhookEvent) => Promise<void> {
	return async (event) => {
		// Cheap check first: most comment webhooks are Cyrus's own.
		if (
			event.comment &&
			tracker.isOwnComment(event.comment.id, event.comment.body)
		) {
			return;
		}
		if (event.comment) {
			tracker.rememberComment(event.comment.id, event.issueKey);
		}
		try {
			const agent = await tracker.agent();
			await coordinator.handle(
				toCommentTrackerEvent(event, agent, tracker.options),
			);
		} catch (error) {
			logger.error(
				`Jira issue ${event.issueKey}: failed to handle webhook`,
				error,
			);
		}
	};
}

/**
 * Whether this event handed the issue to Cyrus ("added") or took it away
 * ("removed"), from its changelog. Assignee changes only count when
 * assignment hands issues over. A webhook without a changelog (e.g. from a
 * Jira Automation rule) counts as handing it over.
 */
export function handOverChange(
	event: JiraWebhookEvent,
	agent: JiraUser,
	options: JiraTriggerOptions,
): "added" | "removed" | undefined {
	if (event.changelog.length === 0) {
		return event.webhookEvent === "jira:issue_updated" ? undefined : "added";
	}
	const label = options.triggerLabel.trim().toLowerCase();
	for (const item of event.changelog) {
		const change =
			item.field === "assignee" && options.triggerOnAssign
				? assigneeChange(item, agent)
				: item.field === "labels" && label
					? labelChange(item, label)
					: undefined;
		if (change) return change;
	}
	return undefined;
}

function assigneeChange(
	item: JiraChangelogItem,
	agent: JiraUser,
): "added" | "removed" | undefined {
	if (item.to === agent.accountId) return "added";
	if (item.from === agent.accountId) return "removed";
	return undefined;
}

function labelChange(
	item: JiraChangelogItem,
	label: string,
): "added" | "removed" | undefined {
	const has = (labels: string | null | undefined) =>
		(labels ?? "").split(/\s+/).some((l) => l.toLowerCase() === label);
	const before = has(item.fromString);
	const after = has(item.toString);
	if (!before && after) return "added";
	if (before && !after) return "removed";
	return undefined;
}

/**
 * Jira Cloud in nyrus. Enabled when JIRA_BASE_URL, JIRA_EMAIL and
 * JIRA_API_TOKEN (of the account Cyrus works as) are set; the webhook only
 * with JIRA_WEBHOOK_SECRET. Repositories that take Jira work use the
 * tracker's key as their linearWorkspaceId: `jira-<site>` (e.g. `jira-novu`
 * for novu.atlassian.net), or JIRA_WORKSPACE_KEY.
 */
export function createJiraIntegrationFactory(
	options: { dispatchTiming?: Partial<DispatchTiming> } = {},
): TrackerIntegrationFactory {
	return ({ env, logger, githubIssues }): TrackerIntegration | null => {
		const baseUrl = env.JIRA_BASE_URL?.trim().replace(/\/+$/, "");
		const email = env.JIRA_EMAIL?.trim();
		const apiToken = env.JIRA_API_TOKEN?.trim();
		if (!baseUrl || !email || !apiToken) {
			return null;
		}
		let site: string;
		try {
			site = new URL(baseUrl).hostname.split(".")[0] ?? "";
		} catch {
			logger.error(`JIRA_BASE_URL is not a URL: ${baseUrl}`);
			return null;
		}
		const tracker = new JiraIssueTrackerService(
			new JiraApiClient({ baseUrl, email, apiToken }),
			env.JIRA_WORKSPACE_KEY?.trim() || `jira-${site}`,
			{
				triggerLabel: env.JIRA_TRIGGER_LABEL?.trim() ?? "nyrus",
				triggerOnAssign:
					env.JIRA_TRIGGER_ON_ASSIGN?.trim().toLowerCase() !== "false",
				startedStatus: env.JIRA_STARTED_STATUS?.trim() || undefined,
				dispatchTiming: options.dispatchTiming,
				githubIssues,
				reviewStatus: env.JIRA_REVIEW_STATUS?.trim(),
				doneStatus: env.JIRA_DONE_STATUS?.trim(),
				logger,
			},
		);
		const webhookSecret = env.JIRA_WEBHOOK_SECRET?.trim() || "";
		let transport: JiraEventTransport | undefined;

		return {
			workspaceKey: tracker.workspaceKey,
			tracker,
			// Named after the platform, so its tools are mcp__jira__*.
			mcpServers: (session) => ({
				jira: tracker.toolsMcpServerConfig(session),
			}),
			register(host) {
				if (!webhookSecret) {
					// An open webhook would let anyone prompt the agent.
					logger.error(
						"JIRA_WEBHOOK_SECRET is not set: the Jira webhook is not registered. Set it to the secret of the Jira webhook (or of the ?secret= in the Automation URL).",
					);
					return;
				}
				const coordinator = tracker.sessions.createCoordinator(host);
				const handle = jiraEventHandler(
					tracker,
					tracker.githubThread
						? tracker.githubThread.wrapCoordinator(coordinator, host)
						: coordinator,
					logger,
				);
				transport = new JiraEventTransport({
					fastifyServer: host.fastify,
					webhookSecret,
				});
				transport.on("event", (event) => {
					void handle(event);
				});
				transport.on("error", (error: Error) =>
					logger.error("Jira transport error", error),
				);
				transport.register();

				const { triggerLabel, triggerOnAssign } = tracker.options;
				const triggers = [
					triggerLabel && `label "${triggerLabel}"`,
					triggerOnAssign && "assignment",
				].filter(Boolean);
				logger.info(
					`✅ Jira registered for ${tracker.api.baseUrl} (key ${tracker.workspaceKey}, starts on ${triggers.join(" or ") || "mentions only"})`,
				);
				// Check the token now; a wrong one would otherwise only show at the first webhook.
				tracker.agent().then(
					(agent) =>
						logger.info(
							`   Jira agent account: ${agent.displayName ?? agent.accountId} (${agent.accountId})`,
						),
					(error) =>
						logger.error(
							"Jira API token check failed (JIRA_EMAIL / JIRA_API_TOKEN). For an Atlassian service account, JIRA_EMAIL is its …@serviceaccount.atlassian.com address, not a mailbox.",
							error,
						),
				);
			},
			async onAgentRunFinished(run) {
				await logAgentRun(tracker.api, run, logger);
			},
			dispose() {
				transport?.removeAllListeners();
				tracker.dispose();
			},
		};
	};
}

/** The Jira integration with default timing, for the edge worker's list. */
export const createJiraIntegration: TrackerIntegrationFactory =
	createJiraIntegrationFactory();

/** Comment of the worklog entries Nyrus writes for its agent runs. */
export const AGENT_RUN_WORKLOG_COMMENT = "🤖 Nyrus: agent run";

/**
 * Log an agent run's time on its issue, rounded to whole minutes (at least
 * one, as Jira requires). A failure (e.g. time tracking turned off) only logs.
 */
export async function logAgentRun(
	api: Pick<JiraApiClient, "addWorklog">,
	run: AgentRunSummary,
	logger: ILogger,
): Promise<void> {
	if (!(run.durationMs > 0)) {
		return;
	}
	const minutes = Math.max(1, Math.round(run.durationMs / 60_000));
	try {
		await api.addWorklog(run.issueId, {
			timeSpentSeconds: minutes * 60,
			started: new Date(run.finishedAt - run.durationMs),
			comment: AGENT_RUN_WORKLOG_COMMENT,
		});
		logger.info(
			`Jira issue ${run.issueIdentifier ?? run.issueId}: logged ${minutes} min of agent work`,
		);
	} catch (error) {
		logger.warn(
			`Jira issue ${run.issueIdentifier ?? run.issueId}: could not log the agent's time (time tracking on, scope write:jira-work?)`,
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}
