import type {
	AgentActivityCreateInput,
	AgentActivityPayload,
	AgentSessionCreateOnCommentInput,
	AgentSessionCreateOnIssueInput,
	IIssueTrackerService,
	ILogger,
} from "cyrus-core";
import { CommentActivityPublisher } from "./CommentActivityPublisher.js";
import {
	CommentSessionCoordinator,
	type DispatchTiming,
} from "./CommentSessionCoordinator.js";
import {
	issueIdFromSessionId,
	SessionStore,
	sessionIdFor,
} from "./SessionStore.js";
import type { CommentTracker, TrackerIntegrationHost } from "./types.js";

type IssueTrackerAgentSession = Awaited<
	ReturnType<IIssueTrackerService["fetchAgentSession"]>
>;
type IssueTrackerAgentSessionPayload = Awaited<
	ReturnType<IIssueTrackerService["createAgentSessionOnIssue"]>
>;

export interface CommentAgentSessionsOptions {
	/** Minimum time between edits of a progress comment (default 20 s). */
	minUpdateMs?: number;
	/** Hand-off timing of the coordinator (tests). */
	timing?: Partial<DispatchTiming>;
	logger?: ILogger;
}

/**
 * Comment-based agent sessions for one tracker workspace. A tracker service
 * keeps one and delegates the agent-session half of `IIssueTrackerService`
 * to it:
 *
 * ```ts
 * createAgentActivity(input) { return this.sessions.createAgentActivity(input); }
 * ```
 *
 * and its transport hands events to {@link createCoordinator}'s result.
 */
export class CommentAgentSessions {
	readonly store = new SessionStore();
	private readonly publisher: CommentActivityPublisher;

	constructor(
		private readonly tracker: CommentTracker,
		private readonly options: CommentAgentSessionsOptions = {},
	) {
		this.publisher = new CommentActivityPublisher(tracker, this.store, {
			minUpdateMs: options.minUpdateMs,
			logger: options.logger,
		});
	}

	/** The session id of a ticket, `<platform>-<issue id>`. */
	sessionIdFor(issueId: string): string {
		return sessionIdFor(this.tracker.platform, issueId);
	}

	/** The coordinator for this workspace's events, bound to the edge worker. */
	createCoordinator(host: TrackerIntegrationHost): CommentSessionCoordinator {
		return new CommentSessionCoordinator({
			tracker: this.tracker,
			store: this.store,
			getSessionState: host.getSessionState,
			dispatch: host.dispatch,
			timing: this.options.timing,
			logger: this.options.logger ?? host.logger,
		});
	}

	async createAgentSessionOnIssue(
		input: AgentSessionCreateOnIssueInput,
	): Promise<IssueTrackerAgentSessionPayload> {
		return {
			success: true,
			lastSyncId: 0,
			agentSession: Promise.resolve({ id: this.sessionIdFor(input.issueId) }),
		} as unknown as IssueTrackerAgentSessionPayload;
	}

	async createAgentSessionOnComment(
		input: AgentSessionCreateOnCommentInput,
	): Promise<IssueTrackerAgentSessionPayload> {
		throw new Error(
			`Starting a ${this.tracker.platform} session on comment ${input.commentId} is not supported: mention the agent in a comment instead`,
		);
	}

	async fetchAgentSession(
		sessionId: string,
	): Promise<IssueTrackerAgentSession> {
		return {
			id: sessionId,
			status: "active",
			issueId: issueIdFromSessionId(this.tracker.platform, sessionId),
		} as unknown as IssueTrackerAgentSession;
	}

	async emitStopSignalEvent(_sessionId: string): Promise<void> {
		// Stops come from the tracker: taking the ticket away, or a "stop" comment.
	}

	async createAgentActivity(
		input: AgentActivityCreateInput,
	): Promise<AgentActivityPayload> {
		const issueId = issueIdFromSessionId(
			this.tracker.platform,
			input.agentSessionId,
		);
		if (!issueId) {
			throw new Error(
				`Not a ${this.tracker.platform} session: ${input.agentSessionId}`,
			);
		}
		const comment = await this.publisher.publish(issueId, input);
		return {
			success: true,
			lastSyncId: 0,
			agentActivity: Promise.resolve({ id: comment.id }),
		} as unknown as AgentActivityPayload;
	}

	dispose(): void {
		this.publisher.dispose();
	}
}
