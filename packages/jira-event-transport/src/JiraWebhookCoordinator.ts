import { createLogger, type ILogger } from "cyrus-core";
import {
	type JiraIssueTrackerService,
	jiraSessionId,
} from "./JiraIssueTrackerService.js";
import { mentionsAgent, promptFromComment } from "./JiraText.js";
import type {
	JiraChangelogItem,
	JiraIssue,
	JiraTriggerOptions,
	JiraUser,
	JiraWebhookEvent,
} from "./types.js";

/** Linear-shaped AgentSessionEvent webhook, as the edge worker consumes it. */
export type LinearShapedAgentSessionWebhook = Record<string, unknown> & {
	type: "AgentSessionEvent";
	action: "created" | "prompted";
	organizationId: string;
};

/** How long the next event for an issue waits for the edge worker to take this one over. */
export interface JiraDispatchTiming {
	/** After a prompt, at most this long. */
	promptSettleMs: number;
	/** After a new session, until the edge worker knows it, checked this often... */
	startPollMs: number;
	/** ...for at most this long. */
	startSettleMaxMs: number;
}

const DEFAULT_TIMING: JiraDispatchTiming = {
	promptSettleMs: 5_000,
	startPollMs: 250,
	startSettleMaxMs: 2 * 60 * 1000,
};

export interface JiraWebhookCoordinatorDeps {
	tracker: JiraIssueTrackerService;
	/** True if Cyrus already has a session (or a pending question) with this id. */
	isKnownSession: (sessionId: string) => boolean;
	/** True if the session waits for the user's answer (repository selection, AskUserQuestion). */
	isAwaitingAnswer?: (sessionId: string) => boolean;
	/** Hand the Linear-shaped webhook to the edge worker. */
	dispatch: (webhook: LinearShapedAgentSessionWebhook) => Promise<void> | void;
	logger?: ILogger;
	timing?: Partial<JiraDispatchTiming>;
}

/** What an issue event changed about the hand-over to Cyrus. */
type HandOverChange = "added" | "removed" | undefined;

/** A hand-over this soon after a session started is part of starting it. */
const RECENT_START_MS = 2 * 60 * 1000;

/** Sent as the prompt when an issue Cyrus already worked on is handed back. */
export const HANDED_BACK_PROMPT =
	"This issue was handed to you again in Jira. Re-read it (its description and comments may have changed) and continue.";

/**
 * Turns Jira webhooks into the AgentSessionEvent webhooks the edge worker
 * already handles for Linear. Every issue has at most one Cyrus session (see
 * `jiraSessionId`).
 *
 * - An issue assigned to the agent account, or given the trigger label, starts
 *   a delegation: the session gets no comment, so Cyrus works the whole issue.
 *   Handing an issue back after its session ended continues that session.
 * - Unassigning the agent, or removing the label, stops the session.
 * - A comment that mentions the agent on an issue without a session starts a
 *   conversation on that comment, like a Linear @mention.
 * - On an issue with a session, comments are follow-up prompts: all of them
 *   while the issue is handed to Cyrus, afterwards only those that mention
 *   it or answer a question it asked. A comment saying just "stop" stops the
 *   session.
 * - Cyrus's own comments are ignored.
 *
 * The issue is always read fresh from Jira, so the webhook only has to say
 * which issue changed. Events for the same issue are decided one at a time,
 * in arrival order. The edge worker's handling of a webhook lasts as long as
 * the agent run it starts, so the next event only waits until the edge worker
 * has taken the previous one over; a stop or an answer to a question must
 * reach the running session.
 */
export class JiraWebhookCoordinator {
	/** Sessions this coordinator started, with when. */
	private readonly started = new Map<string, number>();
	private readonly queues = new Map<string, Promise<void>>();
	private readonly logger: ILogger;
	private readonly timing: JiraDispatchTiming;

	constructor(private readonly deps: JiraWebhookCoordinatorDeps) {
		this.logger =
			deps.logger ?? createLogger({ component: "JiraWebhookCoordinator" });
		this.timing = { ...DEFAULT_TIMING, ...deps.timing };
	}

	handle(event: JiraWebhookEvent): Promise<void> {
		const key = event.issueKey;
		const previous = this.queues.get(key) ?? Promise.resolve();
		const next = previous
			.then(() => this.process(event))
			.catch((error) => {
				this.logger.error(`Jira issue ${key}: failed to handle webhook`, error);
			});
		this.queues.set(key, next);
		void next.finally(() => {
			if (this.queues.get(key) === next) {
				this.queues.delete(key);
			}
		});
		return next;
	}

	private async process(event: JiraWebhookEvent): Promise<void> {
		const { tracker } = this.deps;
		const { comment } = event;

		// Cheap check first: most comment webhooks are Cyrus's own.
		if (comment && tracker.isOwnComment(comment.id, comment.body)) {
			return;
		}

		const [agent, issue] = await Promise.all([
			tracker.agent(),
			tracker.fetchJiraIssue(event.issueKey),
		]);
		const sessionId = jiraSessionId(issue.id);
		const known =
			this.started.has(sessionId) || this.deps.isKnownSession(sessionId);
		const handedOver = tracker.isHandedToAgent(issue, agent);

		if (event.kind === "comment" && comment) {
			tracker.rememberComment(comment.id, issue.id);
			const mentioned = mentionsAgent(comment.body, agent.accountId);
			const text = promptFromComment(comment.body, agent.accountId);
			const actor = comment.authorAccountId
				? {
						accountId: comment.authorAccountId,
						displayName: comment.authorName,
						emailAddress:
							event.actor?.accountId === comment.authorAccountId
								? event.actor.emailAddress
								: undefined,
					}
				: event.actor;
			// While the issue is handed to Cyrus every comment steers it;
			// otherwise only comments that mention it, or answer its question.
			const answers = this.deps.isAwaitingAnswer?.(sessionId) ?? false;
			if (known && (handedOver || mentioned || answers)) {
				await this.dispatch("prompted", issue, agent, actor, {
					commentId: comment.id,
					body: text,
				});
			} else if (!known && mentioned) {
				this.markStarted(sessionId);
				await this.dispatch("created", issue, agent, actor, {
					commentId: comment.id,
					body: text,
				});
			}
			return;
		}

		const change = handOverChange(event, agent, tracker.options);
		if (handedOver && !known) {
			this.markStarted(sessionId);
			await this.dispatch("created", issue, agent, event.actor, {});
		} else if (
			handedOver &&
			change === "added" &&
			!this.startedRecently(sessionId)
		) {
			await this.dispatch("prompted", issue, agent, event.actor, {
				body: HANDED_BACK_PROMPT,
			});
		} else if (!handedOver && known && change === "removed") {
			// A hand-over right after this one is a real one again.
			this.started.delete(sessionId);
			await this.dispatch("prompted", issue, agent, event.actor, {
				body: "stop",
				stop: true,
			});
		}
	}

	private markStarted(sessionId: string): void {
		this.started.set(sessionId, Date.now());
	}

	/**
	 * Assigning and labelling an issue in one go sends two webhooks; the
	 * second one shouldn't tell the new session it was "handed back".
	 */
	private startedRecently(sessionId: string): boolean {
		const at = this.started.get(sessionId);
		return at !== undefined && Date.now() - at < RECENT_START_MS;
	}

	/**
	 * The actor with an email, if Jira will tell: user access control matches
	 * by account id or email, and webhooks often leave the email out.
	 */
	private async withEmail(
		actor: JiraUser | undefined,
	): Promise<JiraUser | undefined> {
		if (!actor || actor.emailAddress) {
			return actor;
		}
		try {
			const user = await this.deps.tracker.fetchUser(actor.accountId);
			return {
				...actor,
				displayName: actor.displayName ?? user.name,
				emailAddress: user.email || undefined,
			};
		} catch {
			return actor;
		}
	}

	private async dispatch(
		action: "created" | "prompted",
		jiraIssue: JiraIssue,
		agent: JiraUser,
		actor: JiraUser | undefined,
		prompt: { commentId?: string; body?: string; stop?: boolean },
	): Promise<void> {
		const { tracker } = this.deps;
		const issue = tracker.toIssue(jiraIssue);
		const [team, creator] = await Promise.all([
			issue.team,
			this.withEmail(actor),
		]);
		const sessionId = jiraSessionId(jiraIssue.id);
		const now = new Date();

		const webhook: LinearShapedAgentSessionWebhook = {
			type: "AgentSessionEvent",
			action,
			organizationId: tracker.workspaceKey,
			oauthClientId: "jira",
			appUserId: agent.accountId,
			createdAt: now,
			guidance: [],
			agentSession: {
				id: sessionId,
				appUserId: agent.accountId,
				organizationId: tracker.workspaceKey,
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
				status: "active",
				type: "issue",
				issueId: issue.id,
				issue: {
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					url: issue.url,
					teamId: team?.id,
					team: team
						? { id: team.id, key: team.key, name: team.name }
						: undefined,
				},
				...(action === "created" &&
					prompt.body !== undefined && {
						comment: { id: prompt.commentId ?? "", body: prompt.body },
					}),
				...(creator && {
					creator: {
						id: creator.accountId,
						name: creator.displayName ?? creator.accountId,
						email: creator.emailAddress ?? "",
					},
				}),
			},
		};

		if (action === "prompted") {
			webhook.agentActivity = {
				id: `jira-activity-${prompt.commentId ?? now.getTime()}`,
				agentSessionId: sessionId,
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
				content: { type: "prompt", body: prompt.body ?? "" },
				...(prompt.stop && { signal: "stop" }),
				...(prompt.commentId && { sourceCommentId: prompt.commentId }),
			};
		}

		this.logger.info(`Jira issue ${jiraIssue.key}: dispatching ${action}`);
		await this.deliver(action, sessionId, jiraIssue.key, webhook);
	}

	/**
	 * Hand the webhook to the edge worker without waiting for the agent run
	 * it starts: return once the edge worker is done with it, or has taken it
	 * over (a new session is known to it; a prompt had a few seconds to reach
	 * the session).
	 */
	private async deliver(
		action: "created" | "prompted",
		sessionId: string,
		key: string,
		webhook: LinearShapedAgentSessionWebhook,
	): Promise<void> {
		const delivery = Promise.resolve()
			.then(() => this.deps.dispatch(webhook))
			.catch((error) => {
				this.logger.error(
					`Jira issue ${key}: handling ${action} failed`,
					error,
				);
			});
		let settled = false;
		const { promptSettleMs, startPollMs, startSettleMaxMs } = this.timing;
		const takenOver =
			action === "created"
				? (async () => {
						const deadline = Date.now() + startSettleMaxMs;
						while (
							!settled &&
							Date.now() < deadline &&
							!this.deps.isKnownSession(sessionId)
						) {
							await sleep(startPollMs);
						}
					})()
				: sleep(promptSettleMs);
		await Promise.race([delivery, takenOver]);
		settled = true;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref?.();
	});
}

/**
 * Whether this event handed the issue to Cyrus ("added") or took it away
 * ("removed"), from its changelog. Assignee changes only count when
 * assignment hands issues over. A webhook without a changelog (e.g. from a
 * Jira Automation rule) counts as handing it over.
 */
function handOverChange(
	event: JiraWebhookEvent,
	agent: JiraUser,
	options: JiraTriggerOptions,
): HandOverChange {
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
): HandOverChange {
	if (item.to === agent.accountId) return "added";
	if (item.from === agent.accountId) return "removed";
	return undefined;
}

function labelChange(item: JiraChangelogItem, label: string): HandOverChange {
	const has = (labels: string | null | undefined) =>
		(labels ?? "").split(/\s+/).some((l) => l.toLowerCase() === label);
	const before = has(item.fromString);
	const after = has(item.toString);
	if (!before && after) return "added";
	if (before && !after) return "removed";
	return undefined;
}
