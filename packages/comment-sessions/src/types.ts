import type { IIssueTrackerService, ILogger, Issue, User } from "cyrus-core";
import type { FastifyInstance } from "fastify";

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
 */

// ---------------------------------------------------------------------------
// Inbound: what a tracker's transport reports
// ---------------------------------------------------------------------------

interface CommentTrackerEventBase {
	/**
	 * Unique per delivery of the same change, so retried webhooks can be
	 * dropped (e.g. ClickUp's history item id, Jira's webhook event id).
	 */
	eventId: string;
	/** The tracker's id for the ticket, the same id `fetchIssue` returns. */
	issueId: string;
	/** Tracker user who caused the event. Events by the bot itself are dropped. */
	actorId?: string;
}

/** The bot was assigned to the ticket: work the whole ticket. */
export interface IssueAssignedEvent extends CommentTrackerEventBase {
	kind: "assigned";
}

/** The bot was unassigned: stop working on the ticket. */
export interface IssueUnassignedEvent extends CommentTrackerEventBase {
	kind: "unassigned";
}

/** A comment was posted on the ticket. */
export interface IssueCommentEvent extends CommentTrackerEventBase {
	kind: "comment";
	commentId: string;
	/**
	 * The comment as Markdown (or plain text), with mentions of the bot
	 * removed, so "@bot stop" arrives as "stop".
	 */
	body: string;
	/** True if the comment mentions the bot. */
	mentionsBot: boolean;
}

export type CommentTrackerEvent =
	| IssueAssignedEvent
	| IssueUnassignedEvent
	| IssueCommentEvent;

// ---------------------------------------------------------------------------
// The tracker: what each integration implements
// ---------------------------------------------------------------------------

/**
 * The comment operations a tracker integration provides. Bodies are Markdown;
 * the tracker converts them to its own format (ClickUp rich text, Jira ADF).
 */
export interface CommentTracker {
	/** Short platform name for ids and logs, e.g. "clickup". */
	readonly platform: string;
	/**
	 * Key of the tracker's workspace in Cyrus: the webhooks' `organizationId`,
	 * and the `linearWorkspaceId` of the repositories that take its work.
	 */
	readonly workspaceKey: string;
	/** Tracker user id of the bot, to ignore its own comments and changes. */
	readonly botUserId: string;

	fetchIssue(issueId: string): Promise<Issue>;
	fetchUser(userId: string): Promise<User>;
	/** Post a comment; returns its id. */
	postComment(issueId: string, markdown: string): Promise<{ id: string }>;
	updateComment(
		issueId: string,
		commentId: string,
		markdown: string,
	): Promise<void>;
	deleteComment(issueId: string, commentId: string): Promise<void>;
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
	type: "AgentSessionEvent" | "AppUserNotification";
	action: string;
	organizationId: string;
};

/** What the edge worker gives a tracker integration when it is registered. */
export interface TrackerIntegrationHost {
	fastify: FastifyInstance;
	/** Hand a Linear-shaped webhook to the edge worker. */
	dispatch: (webhook: LinearShapedWebhook) => Promise<void>;
	getSessionState: (sessionId: string) => SessionState;
	logger: ILogger;
}

/**
 * A tracker plugged into the edge worker: its issue tracker service, the MCP
 * servers its sessions get, and the webhook routes it registers.
 */
export interface TrackerIntegration {
	readonly workspaceKey: string;
	readonly tracker: IIssueTrackerService;
	/** MCP servers for sessions in this workspace, keyed by server name. */
	mcpServers?(): Record<string, StdioMcpServerConfig>;
	/** Register webhook routes; called once the shared server exists. */
	register(host: TrackerIntegrationHost): void;
	dispose?(): void;
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
}) => TrackerIntegration | null;

export interface StdioMcpServerConfig {
	type: "stdio";
	command: string;
	args: string[];
	env: Record<string, string>;
}
