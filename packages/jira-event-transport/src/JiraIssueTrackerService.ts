import {
	attachedFilesNote,
	CommentAgentSessions,
	type CommentTracker,
	type DispatchTiming,
	type GitHubIssueThreads,
	type GitHubThreadedTracker,
	type GitHubThreadSource,
	isImageFile,
	type PullRequestRef,
	sessionIdFor,
	issueIdFromSessionId as sessionIssueId,
	type TicketComment,
	type TrackerMcpSession,
} from "cyrus-comment-sessions";
import {
	type AgentActivityCreateInput,
	type AgentActivityPayload,
	type AgentEventTransportConfig,
	type AgentSessionCreateOnCommentInput,
	type AgentSessionCreateOnIssueInput,
	type Comment,
	type CommentCreateInput,
	type CommentWithAttachments,
	type Connection,
	createLogger,
	type FetchChildrenOptions,
	type FileUploadRequest,
	type FileUploadResponse,
	type IAgentEventTransport,
	type IIssueTrackerService,
	type ILogger,
	type Issue,
	type IssueUpdateInput,
	type IssueWithChildren,
	type Label,
	type PaginationOptions,
	type Team,
	type User,
	type WorkflowState,
} from "cyrus-core";
import type { JiraApiClient } from "./JiraApiClient.js";
import {
	isSigned,
	markdownToWiki,
	signed,
	wikiToMarkdown,
} from "./JiraText.js";
import { jiraToolsMcpServerConfig } from "./mcp/JiraToolsServer.js";
import type {
	JiraComment,
	JiraIssue,
	JiraProject,
	JiraStatus,
	JiraTriggerOptions,
	JiraUser,
} from "./types.js";

type IssueTrackerAgentSession = Awaited<
	ReturnType<IIssueTrackerService["fetchAgentSession"]>
>;
type IssueTrackerAgentSessionPayload = Awaited<
	ReturnType<IIssueTrackerService["createAgentSessionOnIssue"]>
>;

const CACHE_TTL_MS = 5 * 60 * 1000;

/** Jira status categories onto Linear state types. */
const STATE_TYPES: Record<string, string> = {
	new: "unstarted",
	indeterminate: "started",
	done: "completed",
};

// Linear priorities: 0 none, 1 urgent, 2 high, 3 normal, 4 low.
const PRIORITY_TO_NUMBER: Record<string, number> = {
	highest: 1,
	high: 2,
	medium: 3,
	low: 4,
	lowest: 4,
};
const NUMBER_TO_PRIORITY = [undefined, "Highest", "High", "Medium", "Low"];

const PLATFORM = "jira";

/**
 * Jira has no agent sessions, so Cyrus keeps one session per issue, with an
 * id derived from the issue's id (`jira-<id>`, see cyrus-comment-sessions):
 * comments on the issue continue it, also after a restart.
 */
export function jiraSessionId(issueId: string): string {
	return sessionIdFor(PLATFORM, issueId);
}

export function issueIdFromSessionId(sessionId: string): string | undefined {
	return sessionIssueId(PLATFORM, sessionId);
}

export interface JiraIssueTrackerOptions extends JiraTriggerOptions {
	/**
	 * Status (by name, case-insensitive) work starts in, e.g. "In Progress"
	 * from JIRA_STARTED_STATUS. Default: the first status of the "In
	 * Progress" category.
	 */
	startedStatus?: string;
	logger?: ILogger;
	/** Minimum time between edits of a progress comment (tests). */
	progressMinUpdateMs?: number;
	/** Hand-off timing of the session coordinator (tests). */
	dispatchTiming?: Partial<DispatchTiming>;
	/** Work tickets in GitHub issues (see cyrus-comment-sessions). */
	githubIssues?: GitHubIssueThreads;
	/**
	 * Status (by name) an issue moves to when a pull request for it is opened.
	 * Default: the first status reachable whose name contains "review"; empty
	 * to never move it.
	 */
	reviewStatus?: string;
	/**
	 * Status (by name) an issue moves to when its GitHub issue is closed.
	 * Default: the first "Done"-category status reachable; empty to never move it.
	 */
	doneStatus?: string;
}

/**
 * IIssueTrackerService for Jira Cloud.
 *
 * Cyrus's issue-tracker abstraction is shaped after Linear's SDK, so this
 * service translates Jira resources into those shapes, like the Plane
 * adapter: a Jira project plays the role of both Linear's team (its key is
 * the prefix of "ZOO-12") and Linear's project (its name is what
 * `projectKeys` routing matches), and Jira status categories map onto Linear
 * state types. Moving an issue to a state runs the workflow transition that
 * leads there.
 *
 * Sessions are cyrus-comment-sessions': agent activities become comments,
 * written (and signed) as the agent account: thoughts and actions update one
 * progress comment, while responses, questions and errors are posted as
 * comments of their own. This service is the `CommentTracker` they use.
 */
export class JiraIssueTrackerService
	implements IIssueTrackerService, CommentTracker, GitHubThreadSource
{
	readonly platform = PLATFORM;
	readonly trackerName = "Jira";
	/** Set when tickets are worked in GitHub issues. */
	readonly githubThread?: GitHubThreadedTracker;
	/** Session handling shared with the other comment trackers (ClickUp). */
	readonly sessions: CommentAgentSessions;
	private readonly logger: ILogger;
	private readonly commentIssues = new Map<string, string>();
	private readonly cache = new Map<string, { at: number; value: unknown }>();
	private agentRequest: Promise<JiraUser> | null = null;

	constructor(
		readonly api: JiraApiClient,
		readonly workspaceKey: string,
		readonly options: JiraIssueTrackerOptions,
	) {
		this.logger =
			options.logger ?? createLogger({ component: "JiraIssueTrackerService" });
		this.githubThread = options.githubIssues?.attach(this);
		this.sessions = new CommentAgentSessions(this.githubThread ?? this, {
			minUpdateMs: options.progressMinUpdateMs,
			timing: options.dispatchTiming,
			logger: this.logger,
		});
	}

	/** The agent account: whoever the API token belongs to. */
	agent(): Promise<JiraUser> {
		this.agentRequest ??= this.api.myself().catch((error) => {
			this.agentRequest = null;
			throw error;
		});
		return this.agentRequest;
	}

	/** True if the issue is handed to Cyrus: assigned to its account, or labelled. */
	isHandedToAgent(issue: JiraIssue, agent: JiraUser): boolean {
		const { triggerLabel, triggerOnAssign } = this.options;
		if (
			triggerOnAssign &&
			issue.fields.assignee?.accountId === agent.accountId
		) {
			return true;
		}
		const label = triggerLabel.trim().toLowerCase();
		return (
			Boolean(label) &&
			(issue.fields.labels ?? []).some((l) => l.toLowerCase() === label)
		);
	}

	/** Remember which issue a comment is on (comment endpoints need it). */
	rememberComment(commentId: string, issueId: string): void {
		this.commentIssues.set(commentId, issueId);
	}

	/** True for comments Cyrus wrote itself; their webhooks are ignored. */
	isOwnComment(commentId: string, body?: string): boolean {
		return this.sessions.store.isOwnComment(commentId) || isSigned(body);
	}

	// ========================================================================
	// COMMENT TRACKER (for cyrus-comment-sessions)
	// ========================================================================

	async fetchIssueState(
		idOrKey: string,
	): Promise<{ issue: Issue; handedOver: boolean }> {
		const [agent, jiraIssue] = await Promise.all([
			this.agent(),
			this.fetchJiraIssue(idOrKey),
		]);
		return {
			issue: this.toIssue(jiraIssue),
			handedOver: this.isHandedToAgent(jiraIssue, agent),
		};
	}

	/** Markdown as signed wiki markup. Jira can't post a comment silently; edits are. */
	async postComment(
		issueId: string,
		markdown: string,
	): Promise<{ id: string }> {
		const comment = await this.api.createComment(
			issueId,
			signed(markdownToWiki(markdown)),
		);
		this.rememberComment(comment.id, issueId);
		return { id: comment.id };
	}

	async updateComment(
		issueId: string,
		commentId: string,
		markdown: string,
	): Promise<void> {
		await this.api.updateComment(
			issueId,
			commentId,
			signed(markdownToWiki(markdown)),
		);
	}

	async deleteComment(issueId: string, commentId: string): Promise<void> {
		await this.api.deleteComment(issueId, commentId);
	}

	// ========================================================================
	// GITHUB ISSUES (for cyrus-comment-sessions' GitHubIssueThreads)
	// ========================================================================

	async ticketComments(issueId: string): Promise<TicketComment[]> {
		const comments = await this.api.listComments(issueId);
		return comments
			.filter((c) => !isSigned(c.body))
			.map((c) => ({
				author:
					c.author?.displayName ||
					c.author?.emailAddress ||
					c.author?.accountId ||
					"Someone",
				createdAt: c.created ? new Date(c.created) : undefined,
				body: wikiToMarkdown(c.body ?? ""),
			}));
	}

	async attachPullRequest(issueId: string, pr: PullRequestRef): Promise<void> {
		await this.api.upsertRemoteLink(
			issueId,
			pr.url,
			`Pull request ${pr.repo}#${pr.number}${pr.title ? `: ${pr.title}` : ""}`,
		);
	}

	async moveToStage(issueId: string, stage: "review" | "done"): Promise<void> {
		const wanted =
			stage === "review" ? this.options.reviewStatus : this.options.doneStatus;
		if (wanted === "") return; // turned off
		const transitions = await this.api.listTransitions(issueId);
		const transition = wanted
			? transitions.find(
					(t) => t.to.name.trim().toLowerCase() === wanted.trim().toLowerCase(),
				)
			: stage === "review"
				? transitions.find((t) => /review/i.test(t.to.name))
				: transitions.find((t) => t.to.statusCategory?.key === "done");
		if (!transition) {
			this.logger.warn(
				`Jira issue ${issueId}: no transition to ${wanted ? `"${wanted}"` : `a ${stage} status`} (possible: ${transitions.map((t) => t.to.name).join(", ") || "none"})`,
			);
			return;
		}
		await this.api.transitionIssue(issueId, transition.id);
	}

	fetchJiraIssue(idOrKey: string): Promise<JiraIssue> {
		return this.api.getIssue(idOrKey);
	}

	issueUrl(key: string): string {
		return this.api.issueUrl(key);
	}

	// ========================================================================
	// ISSUES
	// ========================================================================

	async fetchIssue(idOrIdentifier: string): Promise<Issue> {
		const issue = this.toIssue(await this.api.getIssue(idOrIdentifier));
		return this.githubThread ? this.githubThread.decorateIssue(issue) : issue;
	}

	async fetchIssueChildren(
		issueId: string,
		_options?: FetchChildrenOptions,
	): Promise<IssueWithChildren> {
		const issue = await this.fetchIssue(issueId);
		return { ...issue, children: [], childCount: 0 } as IssueWithChildren;
	}

	async updateIssue(
		issueId: string,
		updates: IssueUpdateInput,
	): Promise<Issue> {
		const fields: Record<string, unknown> = {};
		if (updates.title !== undefined) fields.summary = updates.title;
		if (updates.description !== undefined)
			fields.description = markdownToWiki(updates.description);
		if (updates.assigneeId !== undefined)
			fields.assignee = updates.assigneeId
				? { accountId: updates.assigneeId }
				: null;
		if (updates.priority !== undefined) {
			const name = NUMBER_TO_PRIORITY[Number(updates.priority)];
			if (name) fields.priority = { name };
		}
		if (updates.labelIds !== undefined) fields.labels = updates.labelIds;
		if (updates.parentId) fields.parent = { id: updates.parentId };
		if (Object.keys(fields).length > 0) {
			await this.api.updateIssue(issueId, fields);
		}
		if (updates.stateId) {
			await this.transitionTo(issueId, updates.stateId);
		}
		return this.fetchIssue(issueId);
	}

	async fetchIssueAttachments(
		_issueId: string,
	): Promise<Array<{ title: string; url: string }>> {
		// Jira's attachment URLs need the agent's credentials; sessions download
		// them with the jira MCP server's download_attachments tool.
		return [];
	}

	// ========================================================================
	// COMMENTS
	// ========================================================================

	async fetchComments(
		issueId: string,
		_options?: PaginationOptions,
	): Promise<Connection<Comment>> {
		const comments = await this.api.listComments(issueId);
		for (const c of comments) {
			this.rememberComment(c.id, issueId);
		}
		return { nodes: comments.map((c) => this.toComment(c, issueId)) };
	}

	async fetchComment(commentId: string): Promise<Comment> {
		const issueId = this.commentIssues.get(commentId);
		if (!issueId) {
			throw new Error(`Jira comment ${commentId}: unknown issue`);
		}
		return this.toComment(
			await this.api.getComment(issueId, commentId),
			issueId,
		);
	}

	async fetchCommentWithAttachments(
		commentId: string,
	): Promise<CommentWithAttachments> {
		return { ...(await this.fetchComment(commentId)), attachments: [] };
	}

	async createComment(
		issueId: string,
		input: CommentCreateInput,
	): Promise<Comment> {
		const comment = await this.api.createComment(
			issueId,
			signed(markdownToWiki(input.body)),
		);
		this.rememberOwnComment(comment.id, issueId);
		return this.toComment(comment, issueId);
	}

	// ========================================================================
	// TEAMS (= Jira projects)
	// ========================================================================

	async fetchTeams(_options?: PaginationOptions): Promise<Connection<Team>> {
		const projects = await this.cached("projects", () =>
			this.api.listProjects(),
		);
		return { nodes: projects.map((p) => this.toTeam(p)) };
	}

	async fetchTeam(idOrKey: string): Promise<Team> {
		const project = await this.cached(`project:${idOrKey}`, () =>
			this.api.getProject(idOrKey),
		);
		return this.toTeam(project);
	}

	// ========================================================================
	// LABELS (Jira labels are plain strings: the name is the id)
	// ========================================================================

	async fetchLabels(_options?: PaginationOptions): Promise<Connection<Label>> {
		const labels = await this.cached("labels", () => this.api.listLabels());
		return { nodes: labels.map(toLabel) };
	}

	async fetchLabel(idOrName: string): Promise<Label> {
		return toLabel(idOrName);
	}

	async getIssueLabels(issueId: string): Promise<string[]> {
		return (await this.api.getIssue(issueId)).fields.labels ?? [];
	}

	// ========================================================================
	// WORKFLOW STATES (= Jira statuses)
	// ========================================================================

	async fetchWorkflowStates(
		teamId: string,
		_options?: PaginationOptions,
	): Promise<Connection<WorkflowState>> {
		return {
			nodes: (await this.statuses(teamId)).map((s, i) => toWorkflowState(s, i)),
		};
	}

	async fetchWorkflowState(stateId: string): Promise<WorkflowState> {
		for (const [key, entry] of this.cache) {
			if (!key.startsWith("statuses:")) continue;
			const statuses = entry.value as JiraStatus[];
			const index = statuses.findIndex((s) => s.id === stateId);
			if (index >= 0) return toWorkflowState(statuses[index]!, index);
		}
		return toWorkflowState(await this.api.getStatus(stateId), 0);
	}

	// ========================================================================
	// USERS
	// ========================================================================

	async fetchUser(userId: string): Promise<User> {
		return toUser(
			await this.cached(`user:${userId}`, () => this.api.getUser(userId)),
		);
	}

	/**
	 * Cyrus calls this to keep a Linear OAuth token fresh. For Jira it checks
	 * that the API token still works.
	 */
	async fetchCurrentUser(): Promise<User> {
		return toUser(await this.agent());
	}

	// ========================================================================
	// AGENT SESSIONS (one per issue, see cyrus-comment-sessions)
	// ========================================================================

	createAgentSessionOnIssue(
		input: AgentSessionCreateOnIssueInput,
	): Promise<IssueTrackerAgentSessionPayload> {
		return this.sessions.createAgentSessionOnIssue(input);
	}

	createAgentSessionOnComment(
		input: AgentSessionCreateOnCommentInput,
	): Promise<IssueTrackerAgentSessionPayload> {
		return this.sessions.createAgentSessionOnComment(input);
	}

	fetchAgentSession(sessionId: string): Promise<IssueTrackerAgentSession> {
		return this.sessions.fetchAgentSession(sessionId);
	}

	emitStopSignalEvent(sessionId: string): Promise<void> {
		// Stops come from Jira: unassigning, removing the label, or a "stop" comment.
		return this.sessions.emitStopSignalEvent(sessionId);
	}

	/** Activities become comments (cyrus-comment-sessions' publisher). */
	createAgentActivity(
		input: AgentActivityCreateInput,
	): Promise<AgentActivityPayload> {
		return this.sessions.createAgentActivity(input);
	}

	// ========================================================================
	// UNSUPPORTED / PLATFORM
	// ========================================================================

	async requestFileUpload(
		_request: FileUploadRequest,
	): Promise<FileUploadResponse> {
		throw new Error("File uploads are not supported for Jira yet");
	}

	getPlatformType(): string {
		return "jira";
	}

	getPlatformMetadata(): Record<string, unknown> {
		return { baseUrl: this.api.baseUrl };
	}

	/** MCP server that gives sessions Jira tools, as the agent account. */
	toolsMcpServerConfig(
		session?: TrackerMcpSession,
	): ReturnType<typeof jiraToolsMcpServerConfig> {
		return jiraToolsMcpServerConfig(this.api.getCredentials(), session);
	}

	createEventTransport(
		_config: AgentEventTransportConfig,
	): IAgentEventTransport {
		throw new Error(
			"Jira webhooks are received by JiraEventTransport, registered by the edge worker",
		);
	}

	/** Stop pending progress-comment edits (on shutdown). */
	dispose(): void {
		this.sessions.dispose();
	}

	// ========================================================================
	// HELPERS
	// ========================================================================

	private rememberOwnComment(commentId: string, issueId: string): void {
		this.sessions.store.rememberOwnComment(commentId);
		this.rememberComment(commentId, issueId);
	}

	/**
	 * Run the transition that leads to a status. The status may come from the
	 * project's statuses across all issue types (fetchWorkflowStates), and
	 * workflows differ per issue type; if this issue's workflow can't reach
	 * it, take a transition to a status of the same category instead (e.g.
	 * the Bug workflow's own "In Progress").
	 */
	private async transitionTo(issueId: string, statusId: string): Promise<void> {
		const transitions = await this.api.listTransitions(issueId);
		let transition = transitions.find((t) => t.to.id === statusId);
		if (!transition) {
			const { type } = await this.fetchWorkflowState(statusId);
			transition = transitions.find(
				(t) => STATE_TYPES[t.to.statusCategory?.key ?? ""] === type,
			);
		}
		if (!transition) {
			throw new Error(
				`Jira issue ${issueId} has no transition to status ${statusId} (possible: ${transitions.map((t) => t.to.name).join(", ") || "none"})`,
			);
		}
		await this.api.transitionIssue(issueId, transition.id);
	}

	/** Linear-shaped issue. Public for the webhook coordinator. */
	toIssue(jiraIssue: JiraIssue): Issue {
		const service = this;
		const fields = jiraIssue.fields;
		const project = fields.project;
		const status = fields.status;
		const assignee = fields.assignee;

		const issue = {
			id: jiraIssue.id,
			identifier: jiraIssue.key,
			title: fields.summary,
			description: issueDescription(jiraIssue),
			url: this.api.issueUrl(jiraIssue.key),
			branchName: branchName(jiraIssue.key, fields.summary),
			assigneeId: assignee?.accountId,
			stateId: status?.id,
			teamId: project.id,
			labelIds: fields.labels ?? [],
			priority:
				PRIORITY_TO_NUMBER[fields.priority?.name.toLowerCase() ?? ""] ?? 0,
			createdAt: new Date(fields.created),
			updatedAt: new Date(fields.updated),
			archivedAt: undefined,
			get state() {
				return status ? Promise.resolve(toWorkflowState(status, 0)) : undefined;
			},
			get assignee() {
				return assignee ? Promise.resolve(toUser(assignee)) : undefined;
			},
			get team() {
				return Promise.resolve(service.toTeam(project));
			},
			get parent() {
				return fields.parent
					? service.fetchIssue(fields.parent.key).catch(() => undefined)
					: undefined;
			},
			get project() {
				return Promise.resolve({ id: project.id, name: project.name });
			},
			labels: async () => ({ nodes: (fields.labels ?? []).map(toLabel) }),
			comments: () => service.fetchComments(jiraIssue.id),
			attachments: () => Promise.resolve({ nodes: [] }),
			children: () => Promise.resolve({ nodes: [] }),
			inverseRelations: () => Promise.resolve({ nodes: [] }),
			update: async (input?: IssueUpdateInput) => {
				const updated = await service.updateIssue(jiraIssue.id, input ?? {});
				return {
					success: true,
					issue: Promise.resolve(updated),
					lastSyncId: 0,
				};
			},
		};
		return issue as unknown as Issue;
	}

	private toComment(comment: JiraComment, issueId: string): Comment {
		const service = this;
		const author = comment.author;
		const result = {
			id: comment.id,
			body: wikiToMarkdown(comment.body ?? ""),
			createdAt: new Date(comment.created),
			updatedAt: new Date(comment.updated),
			get user() {
				return author ? Promise.resolve(toUser(author)) : undefined;
			},
			get parent() {
				return undefined;
			},
			get issue() {
				return service.fetchIssue(issueId);
			},
			children: () => Promise.resolve({ nodes: [] }),
		};
		return result as unknown as Comment;
	}

	private toTeam(project: JiraProject): Team {
		const team = {
			id: project.id,
			name: project.name,
			key: project.key,
			description: project.description,
			color: undefined,
			displayName: project.name,
			states: async () => ({
				nodes: (await this.statuses(project.id)).map((s, i) =>
					toWorkflowState(s, i),
				),
			}),
			members: async () => ({ nodes: [] }),
		};
		return team as unknown as Team;
	}

	/** A project's statuses, across its issue types, in workflow order. */
	private statuses(projectIdOrKey: string): Promise<JiraStatus[]> {
		return this.cached(`statuses:${projectIdOrKey}`, async () => {
			const byType = await this.api.listProjectStatuses(projectIdOrKey);
			const seen = new Map<string, JiraStatus>();
			for (const type of byType) {
				for (const status of type.statuses) {
					if (!seen.has(status.id)) seen.set(status.id, status);
				}
			}
			const order = ["new", "indeterminate", "done"];
			// The configured start status leads its category, so it is the
			// "started" state work begins in.
			const started = this.options.startedStatus?.trim().toLowerCase();
			const rank = (status: JiraStatus) =>
				order.indexOf(status.statusCategory?.key ?? "") * 2 +
				(started && status.name.toLowerCase() === started ? 0 : 1);
			return [...seen.values()].sort((a, b) => rank(a) - rank(b));
		});
	}

	private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
		const hit = this.cache.get(key);
		if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
			return hit.value as T;
		}
		const value = await load();
		this.cache.set(key, { at: Date.now(), value });
		return value;
	}
}

/** The description as Markdown, plus a note on attached files. */
function issueDescription(issue: JiraIssue): string {
	const description = wikiToMarkdown(issue.fields.description ?? "");
	const note = attachedFilesNote(
		"jira",
		(issue.fields.attachment ?? []).map((a) => ({
			name: a.filename,
			image: isImageFile(a.filename, a.mimeType),
		})),
	);
	return note ? `${description}\n\n${note}`.trim() : description;
}

function toWorkflowState(status: JiraStatus, position: number): WorkflowState {
	return {
		id: status.id,
		name: status.name,
		type: STATE_TYPES[status.statusCategory?.key ?? ""] ?? "unstarted",
		description: status.description,
		color: "#999999",
		position,
	} as unknown as WorkflowState;
}

function toLabel(name: string): Label {
	return { id: name, name, color: "#999999" } as unknown as Label;
}

function toUser(user: JiraUser): User {
	const name = user.displayName || user.emailAddress || user.accountId;
	return {
		id: user.accountId,
		name,
		displayName: name,
		email: user.emailAddress ?? "",
		gitHubUserId: undefined,
		url: "",
	} as unknown as User;
}

/** e.g. "zoo-12-fix-login-on-mobile", like Linear's branch names. */
export function branchName(key: string, summary: string): string {
	const slug = summary
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50)
		.replace(/-+$/, "");
	return slug ? `${key.toLowerCase()}-${slug}` : key.toLowerCase();
}
