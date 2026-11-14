import type { IIssueTrackerService, ILogger, Issue, User } from "cyrus-core";
import type { FastifyInstance } from "fastify";
import type { GitHubIssueThreads } from "./github/GitHubIssueThreads.js";

/**
 * Agent sessions for trackers that have none built in (ClickUp, Jira).
 *
 * Linear and Plane start an "agent session" when the agent is assigned or
 * mentioned, and the agent answers with session activities. ClickUp and Jira
 * only have tickets and comments, so this package plays the session part:
 * the tracker's transport turns its webhooks into {@link CommentTrackerEvent}s,
 * the {@link CommentSessionCoordinator} turns those into the Linear-shaped
 * AgentSessionEvent webhooks the edge worker already handles, and the
 * {@link CommentActivityPublisher} turns the agent's activities into comments.
 *
 * Every ticket has at most one session, with an id derived from the ticket's
 * id (`<platform>-<issue id>`), so comments continue it, also after a restart.
 */

// ---------------------------------------------------------------------------
// Inbound: what a tracker's transport reports
// ---------------------------------------------------------------------------

/** A tracker user, as far as the webhook tells. */
export interface TrackerUser {
	id: string;
	name?: string;
	email?: string;
}

interface CommentTrackerEventBase {
	/**
	 * Unique per change and the same on a retried delivery, so retries can be
	 * dropped (e.g. ClickUp's history item id). Omit if the tracker has none.
	 */
	eventId?: string;
	/** The ticket, by any id or key the tracker's `fetchIssueState` accepts. */
	issueId: string;
	/** Who caused the event. */
	actor?: TrackerUser;
}

/**
 * The ticket changed. Whether it is handed to the agent is read fresh from
 * the tracker (`fetchIssueState`), so any change can be reported; `handOver`
 * says what this change did to the hand-over, if the transport can tell from
 * the webhook (e.g. the trigger label was added).
 */
export interface IssueChangedEvent extends CommentTrackerEventBase {
	kind: "issue";
	handOver?: "added" | "removed";
}

/** A comment was posted on the ticket. */
export interface IssueCommentEvent extends CommentTrackerEventBase {
	kind: "comment";
	commentId: string;
	/** The comment as Markdown or plain text, with mentions of the agent removed. */
	body: string;
	/** True if the comment mentions the agent (or addresses it, e.g. `/nyrus`). */
	mentionsAgent: boolean;
	/**
	 * True if the tracker recognizes the comment as the agent's own (e.g. by
	 * its signature). Comments the publisher posted are recognized anyway.
	 */
	own?: boolean;
}

export type CommentTrackerEvent = IssueChangedEvent | IssueCommentEvent;

// ---------------------------------------------------------------------------
// The tracker: what each integration implements
// ---------------------------------------------------------------------------

/**
 * What the shared session logic needs from a tracker. Bodies are Markdown;
 * the tracker converts them to its own format (ClickUp rich text, Jira wiki
 * markup) and signs the agent's comments, since the agent may write as a
 * person's account.
 */
export interface CommentTracker {
	/** Short platform name for session ids and logs, e.g. "clickup". */
	readonly platform: string;
	/**
	 * Key of the tracker's workspace in Cyrus: the webhooks' `organizationId`,
	 * and the `linearWorkspaceId` of the repositories that take its work.
	 */
	readonly workspaceKey: string;

	/**
	 * Read the ticket fresh: its Linear-shaped issue (whose `id` keys the
	 * session) and whether it is handed to the agent right now (e.g. has the
	 * trigger label, or is assigned to the agent's account).
	 */
	fetchIssueState(
		issueId: string,
	): Promise<{ issue: Issue; handedOver: boolean }>;
	fetchUser(userId: string): Promise<User>;
	/**
	 * Post a comment as the agent; returns its id. `progress` marks the
	 * "working on it" comment, which is edited often: don't notify watchers.
	 */
	postComment(
		issueId: string,
		markdown: string,
		options?: CommentPostOptions,
	): Promise<{ id: string }>;
	updateComment(
		issueId: string,
		commentId: string,
		markdown: string,
		options?: CommentPostOptions,
	): Promise<void>;
	deleteComment(issueId: string, commentId: string): Promise<void>;
}

/** What a comment the agent posts is for. */
export interface CommentPostOptions {
	/** The "working on it" comment, edited often: don't notify watchers. */
	progress?: boolean;
	/**
	 * The activity it shows: progress, the agent's answer (`response`), a
	 * question, or an error. Trackers may route them differently (e.g. the
	 * GitHub issue layer also reports responses on the ticket).
	 */
	kind?: "progress" | "response" | "question" | "error";
}

// ---------------------------------------------------------------------------
// The host: what the edge worker tells the coordinator
// ---------------------------------------------------------------------------

/**
 * What Cyrus knows about a session:
 * - `working`: the agent is running.
 * - `awaiting-input`: the agent asked a question (or which repository to use)
 *   and waits for the answer.
 * - `idle`: the session exists but has finished; a prompt resumes it.
 * - `unknown`: Cyrus has no such session.
 */
export type SessionState = "working" | "awaiting-input" | "idle" | "unknown";

/** Linear-shaped webhook, as the edge worker's `handleWebhook` consumes it. */
export type LinearShapedWebhook = Record<string, unknown> & {
	type: "AgentSessionEvent";
	action: "created" | "prompted";
	organizationId: string;
};

/** What the edge worker gives a tracker integration when it is registered. */
export interface TrackerIntegrationHost {
	fastify: FastifyInstance;
	/**
	 * Hand a Linear-shaped webhook to the edge worker. The promise settles
	 * when the edge worker is done with it, which for a new session is when
	 * its agent run ends.
	 */
	dispatch: (webhook: LinearShapedWebhook) => Promise<void>;
	getSessionState: (sessionId: string) => SessionState;
	logger: ILogger;
	/**
	 * The repository a ticket was routed to, once the edge worker has picked
	 * one (undefined before that, or if it has none).
	 */
	repositoryForIssue?: (issueId: string) => HostRepository | undefined;
	/** A GitHub token for API calls on a repository (App, stored or PAT). */
	githubToken?: (repositoryId: string) => Promise<string | undefined>;
}

/** A configured repository, as far as tracker integrations need it. */
export interface HostRepository {
	id: string;
	name: string;
	githubUrl?: string;
}

/**
 * A tracker plugged into the edge worker: its issue tracker service, the MCP
 * servers its sessions get, and the webhook routes it registers.
 */
export interface TrackerIntegration {
	readonly workspaceKey: string;
	/**
	 * The tracker's issue tracker service. Optional so a tracker can be wired
	 * up receive-only first (e.g. recording webhook deliveries) before it can
	 * run sessions; without it no work is routed to the workspace.
	 */
	readonly tracker?: IIssueTrackerService;
	/** MCP servers for sessions in this workspace, keyed by server name. */
	mcpServers?(): Record<string, StdioMcpServerConfig>;
	/** Register webhook routes; called once the shared server exists. */
	register(host: TrackerIntegrationHost): void;
	/**
	 * An agent run of a session in this workspace has ended (its result
	 * arrived), e.g. to log the time worked on the ticket. Errors are logged,
	 * never thrown at the agent.
	 */
	onAgentRunFinished?(run: AgentRunSummary): void | Promise<void>;
	dispose?(): void;
}

/** One finished agent run, as {@link TrackerIntegration.onAgentRunFinished} gets it. */
export interface AgentRunSummary {
	sessionId: string;
	/** The ticket's id in the tracker (the Linear-shaped issue id). */
	issueId: string;
	issueIdentifier?: string;
	/** How long the agent worked in this run. */
	durationMs: number;
	/** When the run ended (ms since the epoch). */
	finishedAt: number;
	isError: boolean;
}

/**
 * Builds a tracker integration from the environment, or returns null when the
 * tracker is not configured. The edge worker calls each factory once at
 * startup.
 */
export type TrackerIntegrationFactory = (context: {
	env: NodeJS.ProcessEnv;
	cyrusHome: string;
	logger: ILogger;
	/**
	 * Set when tickets are worked in GitHub issues
	 * (GITHUB_ISSUES_WEBHOOK_SECRET): the tracker attaches itself to it.
	 */
	githubIssues?: GitHubIssueThreads;
}) => TrackerIntegration | null;

export interface StdioMcpServerConfig {
	type: "stdio";
	command: string;
	args: string[];
	env: Record<string, string>;
}
