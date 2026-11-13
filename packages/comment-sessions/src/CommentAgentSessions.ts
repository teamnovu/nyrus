import { join } from "node:path";
import type {
	AgentActivityCreateInput,
	AgentActivityPayload,
	AgentSessionCreateOnCommentInput,
	AgentSessionCreateOnIssueInput,
	IIssueTrackerService,
	ILogger,
} from "cyrus-core";
import { CommentActivityPublisher } from "./CommentActivityPublisher.js";
import { CommentSessionCoordinator } from "./CommentSessionCoordinator.js";
import { SessionDirectory } from "./SessionDirectory.js";
import type { CommentTracker, TrackerIntegrationHost } from "./types.js";

type IssueTrackerAgentSession = Awaited<
	ReturnType<IIssueTrackerService["fetchAgentSession"]>
>;
type IssueTrackerAgentSessionPayload = Awaited<
	ReturnType<IIssueTrackerService["createAgentSessionOnIssue"]>
>;

export interface CommentAgentSessionsOptions {
	/** Where sessions are saved; in memory only when omitted (tests). */
	sessionsFile?: string;
	/** Minimum time between edits of a progress comment (default 15 s). */
	minUpdateMs?: number;
	/**
	 * Pass comments that don't mention the bot to a session while it works or
	 * waits for an answer (default true).
	 */
	followUpsWithoutMention?: boolean;
	logger?: ILogger;
}

/** Default sessions file: `<cyrusHome>/comment-sessions/<workspaceKey>.json`. */
export function sessionsFilePath(
	cyrusHome: string,
	workspaceKey: string,
): string {
	return join(cyrusHome, "comment-sessions", `${workspaceKey}.json`);
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
	readonly directory: SessionDirectory;
	private readonly publisher: CommentActivityPublisher;

	constructor(
		private readonly tracker: CommentTracker,
		private readonly options: CommentAgentSessionsOptions = {},
	) {
		this.directory = new SessionDirectory(
			tracker.platform,
			options.sessionsFile,
		);
		this.publisher = new CommentActivityPublisher(tracker, this.directory, {
			minUpdateMs: options.minUpdateMs,
			logger: options.logger,
		});
	}

	/** The coordinator for this workspace's events, bound to the edge worker. */
	createCoordinator(host: TrackerIntegrationHost): CommentSessionCoordinator {
		return new CommentSessionCoordinator({
			tracker: this.tracker,
			directory: this.directory,
			getSessionState: host.getSessionState,
			dispatch: host.dispatch,
			followUpsWithoutMention: this.options.followUpsWithoutMention,
			logger: this.options.logger ?? host.logger,
		});
	}

	async createAgentSessionOnIssue(
		input: AgentSessionCreateOnIssueInput,
	): Promise<IssueTrackerAgentSessionPayload> {
		const record = this.directory.create(input.issueId);
		return {
			success: true,
			lastSyncId: 0,
			agentSession: Promise.resolve({ id: record.sessionId }),
		} as unknown as IssueTrackerAgentSessionPayload;
	}

	async createAgentSessionOnComment(
		input: AgentSessionCreateOnCommentInput,
	): Promise<IssueTrackerAgentSessionPayload> {
		throw new Error(
			`Starting a ${this.tracker.platform} session on comment ${input.commentId} is not supported: mention the bot in a comment instead`,
		);
	}

	async fetchAgentSession(
		sessionId: string,
	): Promise<IssueTrackerAgentSession> {
		const record = this.directory.get(sessionId);
		if (!record) {
			throw new Error(`Unknown ${this.tracker.platform} session ${sessionId}`);
		}
		return {
			id: record.sessionId,
			issueId: record.issueId,
			status: "active",
		} as unknown as IssueTrackerAgentSession;
	}

	async emitStopSignalEvent(_sessionId: string): Promise<void> {
		// Stops come from the tracker (a "stop" comment or unassigning the bot).
	}

	async createAgentActivity(
		input: AgentActivityCreateInput,
	): Promise<AgentActivityPayload> {
		const comment = await this.publisher.publish(input);
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
