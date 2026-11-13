import { createLogger, type ILogger, type Issue } from "cyrus-core";
import type { SessionDirectory, SessionRecord } from "./SessionDirectory.js";
import type {
	CommentTracker,
	CommentTrackerEvent,
	IssueCommentEvent,
	LinearShapedWebhook,
	SessionState,
} from "./types.js";

export interface CommentSessionCoordinatorDeps {
	tracker: CommentTracker;
	directory: SessionDirectory;
	getSessionState: (sessionId: string) => SessionState;
	/** Hand the Linear-shaped webhook to the edge worker. */
	dispatch: (webhook: LinearShapedWebhook) => Promise<void> | void;
	/**
	 * Pass comments that don't mention the bot to the session while it works
	 * or waits for an answer (default true). Otherwise only mentions reach it.
	 */
	followUpsWithoutMention?: boolean;
	logger?: ILogger;
	now?: () => number;
}

/** Webhooks are retried for minutes, not hours. */
const DEDUPE_TTL_MS = 60 * 60 * 1000;

/** Same as the edge worker's text stop request ("stop", "stop working", ...). */
const STOP_COMMAND = /^\s*stop(\s+session|\s+working)?[\s.!?]*$/i;

/**
 * Turns a comment tracker's events into the AgentSessionEvent webhooks the
 * edge worker handles for Linear, with Cyrus keeping the sessions:
 *
 * - Assigning the bot starts a delegation session (the whole ticket), unless
 *   one is already working on it.
 * - Unassigning it stops the ticket's sessions (as Linear's unassignment).
 * - A comment mentioning the bot resumes the ticket's latest session, or
 *   starts a conversational session on that comment if there is none.
 * - While a session works or waits for an answer, other comments are
 *   follow-ups too, so the bot need not be mentioned in every reply.
 * - "stop" (e.g. "@bot stop") stops a working session.
 *
 * Retried webhooks and the bot's own changes are dropped. Events for the same
 * ticket are handled one at a time, in arrival order.
 */
export class CommentSessionCoordinator {
	private readonly seen = new Map<string, number>();
	private readonly queues = new Map<string, Promise<void>>();
	private readonly logger: ILogger;
	private readonly now: () => number;

	constructor(private readonly deps: CommentSessionCoordinatorDeps) {
		this.logger =
			deps.logger ?? createLogger({ component: "CommentSessionCoordinator" });
		this.now = deps.now ?? Date.now;
	}

	handle(event: CommentTrackerEvent): Promise<void> {
		const { issueId } = event;
		const previous = this.queues.get(issueId) ?? Promise.resolve();
		const next = previous
			.then(() => this.process(event))
			.catch((error) => {
				this.logger.error(
					`${this.deps.tracker.platform} ${issueId}: failed to handle ${event.kind} event`,
					error,
				);
			});
		this.queues.set(issueId, next);
		void next.finally(() => {
			if (this.queues.get(issueId) === next) {
				this.queues.delete(issueId);
			}
		});
		return next;
	}

	private async process(event: CommentTrackerEvent): Promise<void> {
		const { tracker, directory } = this.deps;
		if (this.isDuplicate(event.eventId)) {
			this.logger.debug(`Dropping duplicate event ${event.eventId}`);
			return;
		}
		if (event.actorId && event.actorId === tracker.botUserId) {
			return; // the bot's own comment or change
		}

		const latest = directory.latestForIssue(event.issueId);
		const state = latest
			? this.deps.getSessionState(latest.sessionId)
			: "unknown";
		const busy = state === "working" || state === "awaiting-input";

		switch (event.kind) {
			case "assigned": {
				if (latest && busy) {
					this.logger.info(
						`${event.issueId}: assigned again while session ${latest.sessionId} is ${state}; ignoring`,
					);
					return;
				}
				const record = directory.create(event.issueId);
				await this.dispatchSession("created", record, event.actorId);
				return;
			}

			case "unassigned":
				await this.dispatchUnassigned(event.issueId);
				return;

			case "comment":
				await this.processComment(event, latest, state, busy);
				return;
		}
	}

	private async processComment(
		event: IssueCommentEvent,
		latest: SessionRecord | undefined,
		state: SessionState,
		busy: boolean,
	): Promise<void> {
		const { directory } = this.deps;
		const followUps = this.deps.followUpsWithoutMention ?? true;

		if (STOP_COMMAND.test(event.body)) {
			if (latest && busy && (event.mentionsBot || followUps)) {
				await this.dispatchSession("prompted", latest, event.actorId, {
					commentId: event.commentId,
					body: event.body,
					stop: true,
				});
			}
			return;
		}

		if (latest && busy && (event.mentionsBot || followUps)) {
			await this.dispatchSession("prompted", latest, event.actorId, {
				commentId: event.commentId,
				body: this.resolveOption(latest, event.body),
			});
			return;
		}

		if (!event.mentionsBot) {
			return; // a comment between people
		}

		if (latest && state === "idle") {
			await this.dispatchSession("prompted", latest, event.actorId, {
				commentId: event.commentId,
				body: event.body,
			});
			return;
		}

		const record = directory.create(event.issueId, event.commentId);
		await this.dispatchSession("created", record, event.actorId, {
			commentId: event.commentId,
			body: event.body,
		});
	}

	/** A reply "2" to a question with options means the second option. */
	private resolveOption(record: SessionRecord, body: string): string {
		const options = record.pendingOptions;
		if (!options?.length) return body;
		this.deps.directory.update(record.sessionId, {
			pendingOptions: undefined,
		});
		const choice = /^\s*(\d+)[.)]?\s*$/.exec(body);
		const index = choice ? Number(choice[1]) - 1 : -1;
		return options[index] ?? body;
	}

	private isDuplicate(eventId: string): boolean {
		const now = this.now();
		for (const [id, at] of this.seen) {
			if (now - at < DEDUPE_TTL_MS) break; // insertion order = time order
			this.seen.delete(id);
		}
		if (this.seen.has(eventId)) return true;
		this.seen.set(eventId, now);
		return false;
	}

	private async dispatchSession(
		action: "created" | "prompted",
		record: SessionRecord,
		actorId: string | undefined,
		comment?: { commentId: string; body: string; stop?: boolean },
	): Promise<void> {
		const { tracker } = this.deps;
		const issue = await tracker.fetchIssue(record.issueId);
		const creator = actorId
			? await tracker.fetchUser(actorId).catch(() => undefined)
			: undefined;
		const now = new Date(this.now()).toISOString();

		const webhook: LinearShapedWebhook = {
			type: "AgentSessionEvent",
			action,
			organizationId: tracker.workspaceKey,
			oauthClientId: tracker.platform,
			appUserId: tracker.botUserId,
			createdAt: now,
			guidance: [],
			agentSession: {
				id: record.sessionId,
				appUserId: tracker.botUserId,
				organizationId: tracker.workspaceKey,
				createdAt: new Date(record.createdAt).toISOString(),
				updatedAt: now,
				status: "active",
				type: "issue",
				issueId: issue.id,
				issue: await issueSummary(issue),
				...(action === "created" &&
					comment && {
						comment: { id: comment.commentId, body: comment.body },
					}),
				...(creator && {
					creator: { id: creator.id, name: creator.name, email: creator.email },
				}),
			},
		};

		if (action === "prompted" && comment) {
			webhook.agentActivity = {
				id: comment.commentId,
				agentSessionId: record.sessionId,
				createdAt: now,
				updatedAt: now,
				content: { type: "prompt", body: comment.body },
				sourceCommentId: comment.commentId,
				...(comment.stop && { signal: "stop" }),
			};
		}

		this.logger.info(
			`${tracker.platform} ${issue.identifier}: dispatching ${action} for session ${record.sessionId}`,
		);
		await this.deps.dispatch(webhook);
	}

	private async dispatchUnassigned(issueId: string): Promise<void> {
		const { tracker } = this.deps;
		const issue = await tracker.fetchIssue(issueId);
		const now = new Date(this.now()).toISOString();
		this.logger.info(
			`${tracker.platform} ${issue.identifier}: bot unassigned, dispatching issueUnassignedFromYou`,
		);
		await this.deps.dispatch({
			type: "AppUserNotification",
			action: "issueUnassignedFromYou",
			organizationId: tracker.workspaceKey,
			oauthClientId: tracker.platform,
			appUserId: tracker.botUserId,
			createdAt: now,
			notification: {
				id: `${tracker.platform}-unassigned-${issueId}-${this.now()}`,
				type: "issueUnassignedFromYou",
				createdAt: now,
				updatedAt: now,
				userId: tracker.botUserId,
				issueId: issue.id,
				issue: await issueSummary(issue),
			},
		});
	}
}

async function issueSummary(issue: Issue): Promise<Record<string, unknown>> {
	const team = await issue.team;
	return {
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		url: issue.url,
		teamId: team?.id,
		team: team ? { id: team.id, key: team.key, name: team.name } : undefined,
	};
}
