import { createLogger, type ILogger, type Issue } from "cyrus-core";
import { type SessionStore, sessionIdFor } from "./SessionStore.js";
import type {
	CommentTracker,
	CommentTrackerEvent,
	IssueChangedEvent,
	IssueCommentEvent,
	LinearShapedWebhook,
	SessionState,
	TrackerUser,
} from "./types.js";

/** How long the next event for a ticket waits for the edge worker to take this one over. */
export interface DispatchTiming {
	/** After a prompt, at most this long. */
	promptSettleMs: number;
	/** After a new session, until the edge worker knows it, checked this often... */
	startPollMs: number;
	/** ...for at most this long. */
	startSettleMaxMs: number;
}

const DEFAULT_TIMING: DispatchTiming = {
	promptSettleMs: 5_000,
	startPollMs: 250,
	startSettleMaxMs: 2 * 60 * 1000,
};

export interface CommentSessionCoordinatorDeps {
	tracker: CommentTracker;
	store: SessionStore;
	getSessionState: (sessionId: string) => SessionState;
	/** Hand the Linear-shaped webhook to the edge worker. */
	dispatch: (webhook: LinearShapedWebhook) => Promise<void> | void;
	logger?: ILogger;
	timing?: Partial<DispatchTiming>;
}

/** A hand-over this soon after a session started is part of starting it. */
const RECENT_START_MS = 2 * 60 * 1000;
/** Retried deliveries come within minutes, not hours. */
const DEDUPE_TTL_MS = 60 * 60 * 1000;

/** Sent as the prompt when a ticket the agent already worked on is handed back. */
export const HANDED_BACK_PROMPT =
	"This issue was handed to you again. Re-read it (its description and comments may have changed) and continue.";

/**
 * Turns a comment tracker's events into the AgentSessionEvent webhooks the
 * edge worker handles for Linear. Every ticket has at most one session.
 *
 * - A ticket handed to the agent (trigger label or tag, or assigned to its
 *   account, as the tracker decides) starts a delegation: the session gets no
 *   comment, so the agent works the whole ticket. Handing a ticket back after
 *   its session ended continues that session.
 * - Taking the ticket away (removing the label, unassigning) stops the session.
 * - A comment that mentions the agent on a ticket without a session starts a
 *   conversation on that comment, like a Linear @mention.
 * - On a ticket with a session, comments are follow-up prompts: all of them
 *   while the ticket is handed over, afterwards only those that mention the
 *   agent or answer a question it asked. A comment saying just "stop" stops
 *   the session (the edge worker reads it as a stop request).
 * - The agent's own comments and retried deliveries are ignored.
 *
 * The ticket is always read fresh from the tracker, so the webhook only has
 * to say which ticket changed. Events for the same ticket are decided one at
 * a time, in arrival order. The edge worker's handling of a new session lasts
 * as long as its agent run, so the next event only waits until the edge
 * worker has taken the previous one over: a stop or an answer to a question
 * must reach the running session.
 */
export class CommentSessionCoordinator {
	/** Sessions this coordinator started, with when. */
	private readonly started = new Map<string, number>();
	private readonly queues = new Map<string, Promise<void>>();
	private readonly handled = new Map<string, number>();
	private readonly logger: ILogger;
	private readonly timing: DispatchTiming;

	constructor(private readonly deps: CommentSessionCoordinatorDeps) {
		this.logger =
			deps.logger ?? createLogger({ component: "CommentSessionCoordinator" });
		this.timing = { ...DEFAULT_TIMING, ...deps.timing };
	}

	handle(event: CommentTrackerEvent): Promise<void> {
		const key = event.issueId;
		const previous = this.queues.get(key) ?? Promise.resolve();
		const next = previous
			.then(() => this.processOnce(event))
			.catch((error) => {
				this.logger.error(
					`${this.deps.tracker.platform} ${key}: failed to handle ${event.kind} event`,
					error,
				);
			});
		this.queues.set(key, next);
		void next.finally(() => {
			if (this.queues.get(key) === next) {
				this.queues.delete(key);
			}
		});
		return next;
	}

	/** Process an event unless it was handled before; only a handled one counts. */
	private async processOnce(event: CommentTrackerEvent): Promise<void> {
		if (event.eventId && this.wasHandled(event.eventId)) {
			this.logger.debug(`Dropping retried event ${event.eventId}`);
			return;
		}
		await this.process(event);
		if (event.eventId) this.handled.set(event.eventId, Date.now());
	}

	private wasHandled(eventId: string): boolean {
		const now = Date.now();
		for (const [id, at] of this.handled) {
			if (now - at < DEDUPE_TTL_MS) break; // insertion order = time order
			this.handled.delete(id);
		}
		return this.handled.has(eventId);
	}

	private async process(event: CommentTrackerEvent): Promise<void> {
		const { tracker, store } = this.deps;
		// Cheap check first: many comment webhooks are the agent's own.
		if (
			event.kind === "comment" &&
			(event.own || store.isOwnComment(event.commentId))
		) {
			return;
		}

		const { issue, handedOver } = await tracker.fetchIssueState(event.issueId);
		const sessionId = sessionIdFor(tracker.platform, issue.id);
		const state = this.deps.getSessionState(sessionId);
		const known = this.started.has(sessionId) || state !== "unknown";

		if (event.kind === "comment") {
			await this.processComment(event, issue, sessionId, {
				known,
				handedOver,
				awaiting: state === "awaiting-input",
			});
			return;
		}
		await this.processIssueChange(event, issue, sessionId, {
			known,
			handedOver,
		});
	}

	private async processComment(
		event: IssueCommentEvent,
		issue: Issue,
		sessionId: string,
		{
			known,
			handedOver,
			awaiting,
		}: { known: boolean; handedOver: boolean; awaiting: boolean },
	): Promise<void> {
		const prompt = { commentId: event.commentId, body: event.body };
		// While the ticket is handed over every comment steers the agent;
		// otherwise only comments that mention it, or answer its question.
		if (known && (handedOver || event.mentionsAgent || awaiting)) {
			await this.dispatch("prompted", issue, sessionId, event.actor, {
				...prompt,
				body: this.deps.store.resolveAnswer(sessionId, event.body),
			});
		} else if (!known && event.mentionsAgent) {
			this.started.set(sessionId, Date.now());
			await this.dispatch("created", issue, sessionId, event.actor, prompt);
		}
	}

	private async processIssueChange(
		event: IssueChangedEvent,
		issue: Issue,
		sessionId: string,
		{ known, handedOver }: { known: boolean; handedOver: boolean },
	): Promise<void> {
		if (handedOver && !known) {
			this.started.set(sessionId, Date.now());
			await this.dispatch("created", issue, sessionId, event.actor, {});
		} else if (
			handedOver &&
			event.handOver === "added" &&
			!this.startedRecently(sessionId)
		) {
			await this.dispatch("prompted", issue, sessionId, event.actor, {
				body: HANDED_BACK_PROMPT,
			});
		} else if (!handedOver && known && event.handOver === "removed") {
			// A hand-over right after this one is a real one again.
			this.started.delete(sessionId);
			await this.dispatch("prompted", issue, sessionId, event.actor, {
				body: "stop",
				stop: true,
			});
		}
	}

	/**
	 * Assigning and labelling a ticket in one go sends two webhooks; the
	 * second one shouldn't tell the new session it was "handed back".
	 */
	private startedRecently(sessionId: string): boolean {
		const at = this.started.get(sessionId);
		return at !== undefined && Date.now() - at < RECENT_START_MS;
	}

	/**
	 * The actor with a name and email, if the tracker will tell: user access
	 * control matches by id or email, and webhooks often leave the email out.
	 * The id is kept even when the lookup fails, so an id-based block list
	 * still applies.
	 */
	private async withDetails(
		actor: TrackerUser | undefined,
	): Promise<TrackerUser | undefined> {
		if (!actor || actor.email) return actor;
		try {
			const user = await this.deps.tracker.fetchUser(actor.id);
			return {
				id: actor.id,
				name: actor.name ?? user.name,
				email: user.email || undefined,
			};
		} catch {
			return actor;
		}
	}

	private async dispatch(
		action: "created" | "prompted",
		issue: Issue,
		sessionId: string,
		actor: TrackerUser | undefined,
		prompt: { commentId?: string; body?: string; stop?: boolean },
	): Promise<void> {
		const { tracker } = this.deps;
		const [team, creator] = await Promise.all([
			issue.team,
			this.withDetails(actor),
		]);
		const now = new Date().toISOString();

		const webhook: LinearShapedWebhook = {
			type: "AgentSessionEvent",
			action,
			organizationId: tracker.workspaceKey,
			oauthClientId: tracker.platform,
			appUserId: tracker.platform,
			createdAt: now,
			guidance: [],
			agentSession: {
				id: sessionId,
				appUserId: tracker.platform,
				organizationId: tracker.workspaceKey,
				createdAt: now,
				updatedAt: now,
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
						id: creator.id,
						name: creator.name ?? creator.id,
						email: creator.email ?? "",
					},
				}),
			},
		};

		if (action === "prompted") {
			webhook.agentActivity = {
				id: `${tracker.platform}-activity-${prompt.commentId ?? Date.now()}`,
				agentSessionId: sessionId,
				createdAt: now,
				updatedAt: now,
				content: { type: "prompt", body: prompt.body ?? "" },
				...(prompt.stop && { signal: "stop" }),
				...(prompt.commentId && { sourceCommentId: prompt.commentId }),
			};
		}

		this.logger.info(
			`${tracker.platform} ${issue.identifier}: dispatching ${action}`,
		);
		await this.deliver(action, sessionId, issue.identifier, webhook);
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
		identifier: string,
		webhook: LinearShapedWebhook,
	): Promise<void> {
		const delivery = Promise.resolve()
			.then(() => this.deps.dispatch(webhook))
			.catch((error) => {
				this.logger.error(
					`${this.deps.tracker.platform} ${identifier}: handling ${action} failed`,
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
							this.deps.getSessionState(sessionId) === "unknown"
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
